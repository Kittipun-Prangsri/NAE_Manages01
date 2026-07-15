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
    const trimmedQuery = String(query || '').trim().toUpperCase();
    const allowedPrefixes = ['SELECT', 'WITH', 'SHOW', 'DESCRIBE'];
    return allowedPrefixes.some(prefix => trimmedQuery.startsWith(prefix));
}

export function hasMultipleStatements(query) {
    return /;\s*\S/.test(String(query || '').trim());
}
