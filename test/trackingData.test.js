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

test('visit query selects the real VN for admitted visits', async t => {
    const query = t.mock.method(hosxpPool, 'query', async () => [[]]);

    await getHosxpVisits('2026-07-06');

    const [sql] = query.mock.calls[0].arguments;
    assert.match(sql, /SELECT\s+v\.vn,/);
    assert.doesNotMatch(sql, /'Admit'/);
});

test('each visit is saved under its own VN together with item_money', async t => {
    const query = t.mock.method(trackerPool, 'query', async () => [{}]);
    const visits = [
        { vn: '690706090001', hn: '1', cid: '1111111111111', fullName: 'Admit One', visitDate: '2026-07-06', uc_money: 10, item_money: 111 },
        { vn: '690706090002', hn: '2', cid: '2222222222222', fullName: 'Admit Two', visitDate: '2026-07-06', uc_money: 20, item_money: 222 }
    ];

    await saveTrackingResults(processCrossCheck(visits, []));

    const [sql, [rows]] = query.mock.calls[0].arguments;
    const columns = /\(vn,[^)]+\)/.exec(sql)[0].slice(1, -1).split(',').map(name => name.trim());
    const column = name => rows.map(row => row[columns.indexOf(name)]);
    assert.deepEqual(column('vn'), ['690706090001', '690706090002']);
    assert.deepEqual(column('item_money'), [111, 222]);
});
