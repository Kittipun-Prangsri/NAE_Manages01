import test from 'node:test';
import assert from 'node:assert/strict';
import { hosxpPool, trackerPool } from '../backend/db.js';
import hosxpReadPool from '../backend/db/hosxpPool.js';
import {
    getHosxpTotalVisits,
    getHosxpVisits,
    getLiveDashboardDeps,
    getLiveDashboardGeo,
    saveTrackingResults
} from '../backend/dataService.js';
import { processCrossCheck } from '../backend/crossCheckLogic.js';
import { getTodayVisitSummary } from '../backend/services/visitService.js';

// Every query is mocked: these tests never reach a database.
const failing = async () => { throw new Error('database down'); };

test('a day without visits reports zeros, not sample numbers', async t => {
    t.mock.method(hosxpPool, 'query', async sql => (sql.includes('totalPersons')
        ? [[{ totalPersons: 0, totalVisits: 0, totalUcMoney: null }]]
        : [[{ completedTreatmentEndpointCount: 0 }]]));

    const stats = await getHosxpTotalVisits('2026-07-06');

    assert.equal(stats.totalPersons, 0);
    assert.equal(stats.totalVisits, 0);
    assert.equal(stats.totalUcMoney, 0);
});

test('empty live dashboard queries stay empty', async t => {
    t.mock.method(hosxpPool, 'query', async () => [[]]);

    assert.deepEqual(await getLiveDashboardGeo('2026-07-06'), []);
    assert.deepEqual(await getLiveDashboardDeps('2026-07-06'), []);
});

test('failed HOSxP statistics queries raise instead of returning sample data', async t => {
    t.mock.method(hosxpPool, 'query', failing);

    for (const load of [getHosxpTotalVisits, getLiveDashboardGeo, getLiveDashboardDeps]) {
        await assert.rejects(() => load('2026-07-06'), /database down/, load.name);
    }
});

test('today-by-tambon: failures are raised and not cached, an empty day is empty', async t => {
    const query = t.mock.method(hosxpReadPool, 'query', failing);
    await assert.rejects(() => getTodayVisitSummary('2705'), /database down/);

    query.mock.mockImplementation(async () => [[]]);
    assert.deepEqual(await getTodayVisitSummary('2705'), []);
});

test('the tracked visit query leaves out admitted patients', async t => {
    const query = t.mock.method(hosxpPool, 'query', async () => [[]]);

    await getHosxpVisits('2026-07-06');

    const [sql] = query.mock.calls[0].arguments;
    assert.match(sql, /SELECT\s+v\.vn,/);
    assert.match(sql, /AND ov\.an IS NULL/);
    assert.doesNotMatch(sql, /'Admit'/);
});

const VISITS = [
    { vn: '690706090001', hn: '1', cid: '1111111111111', fullName: 'Visit One', visitDate: '2026-07-06', uc_money: 10, item_money: 111 },
    { vn: '690706090002', hn: '2', cid: '2222222222222', fullName: 'Visit Two', visitDate: '2026-07-06', uc_money: 20, item_money: 222 }
];

test('each visit is saved under its own VN together with item_money', async t => {
    t.mock.method(hosxpPool, 'query', async () => [[]]);
    const query = t.mock.method(trackerPool, 'query', async () => [{}]);

    await saveTrackingResults(processCrossCheck(VISITS, []));

    const [sql, [rows]] = query.mock.calls[0].arguments;
    const columns = /\(vn,[^)]+\)/.exec(sql)[0].slice(1, -1).split(',').map(name => name.trim());
    const column = name => rows.map(row => row[columns.indexOf(name)]);
    assert.deepEqual(column('vn'), ['690706090001', '690706090002']);
    assert.deepEqual(column('item_money'), [111, 222]);
});

test('saving removes tracked rows of admitted patients for that date only', async t => {
    const hosxp = t.mock.method(hosxpPool, 'query', async () => [[{ vn: '690706080009' }]]);
    const tracker = t.mock.method(trackerPool, 'query', async () => [{}]);

    await saveTrackingResults(processCrossCheck(VISITS, []));

    const [admittedSql, admittedParams] = hosxp.mock.calls[0].arguments;
    assert.match(admittedSql, /an IS NOT NULL/);
    assert.deepEqual(admittedParams, ['2026-07-06']);

    assert.equal(tracker.mock.callCount(), 2);
    const [deleteSql, deleteParams] = tracker.mock.calls[1].arguments;
    assert.match(deleteSql, /^DELETE FROM visit_tracking WHERE visit_date = \? AND vn IN \(\?\)$/);
    assert.deepEqual(deleteParams, ['2026-07-06', ['Admit', '690706080009']]);
});

test('saving nothing deletes nothing', async t => {
    const hosxp = t.mock.method(hosxpPool, 'query', async () => [[]]);
    const tracker = t.mock.method(trackerPool, 'query', async () => [{}]);

    await saveTrackingResults([]);

    assert.equal(hosxp.mock.callCount() + tracker.mock.callCount(), 0);
});
