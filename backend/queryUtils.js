const DEFAULT_HIPDATA_SQL_LIST = "'OFC','UCS','OTH','BMT','XXX','LGO','STP','SSS','SSI','A2','BKK','PTY','A9'";

export function replaceGrafanaMacros(query, visitDate, hipdataCodes) {
    const selectedDate = visitDate || new Date().toISOString().split('T')[0];
    let processed = query;
    processed = processed.replace(/\$__timeFilter\(([^)]+)\)/gi, (match, column) => {
        return `${column.trim()} = '${selectedDate}'`;
    });
    processed = processed.replace(/\$hipdata_code/gi, hipdataCodes || DEFAULT_HIPDATA_SQL_LIST);
    return processed;
}

export function isReadOnlySql(query) {
    // Keep this deliberately conservative: the SQL panel is a reporting tool,
    // not an alternate administration console. CTEs can precede mutating SQL in
    // MySQL, so they are not accepted without a proper SQL parser.
    const normalized = String(query || '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\r\n]*/g, ' ')
        .trim()
        .toUpperCase();
    if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/.test(normalized)) return false;

    const blockedKeywords = /\b(ALTER|ANALYZE|CALL|CHANGE|CREATE|DELETE|DO|DROP|GRANT|HANDLER|INSERT|LOAD|LOCK|OPTIMIZE|RENAME|REPLACE|REVOKE|SET|TRUNCATE|UNLOCK|UPDATE|USE)\b/;
    if (blockedKeywords.test(normalized)) return false;

    // SELECT ... INTO OUTFILE/DUMPFILE writes to the database server filesystem.
    return !/\bINTO\s+(OUTFILE|DUMPFILE)\b/.test(normalized);
}

export function hasMultipleStatements(query) {
    return /;\s*\S/.test(String(query || '').trim());
}
