const FIELD_DEFINITIONS = {
    cid: {
        label: 'เลขบัตรประชาชน',
        required: true,
        aliases: ['เลขบัตร', 'cid', 'CID', 'personalId', 'เลขประจำตัวประชาชน', 'เลขบัตรประชาชน']
    },
    authenCode: {
        label: 'Authen/Claim Code',
        required: true,
        aliases: ['CLAIM CODE', 'claim code', 'authenCode', 'CLAIM_CODE', 'claimcode', 'Authen Code', 'รหัส Authen Code']
    },
    channel: {
        label: 'ช่องทางการขอ Authen Code',
        required: false,
        aliases: ['ช่องทางการขอ Authen Code', 'channel', 'authen_channel', 'ประเภทการขอ', 'ช่องทาง']
    },
    visitDate: {
        label: 'วันที่เข้ารับบริการ',
        required: false,
        aliases: ['วันที่เข้ารับบริการ', 'dateser', 'visitDate', 'serviceDate', 'วันที่บริการ']
    },
    statusUse: {
        label: 'สถานะใช้งาน',
        required: false,
        aliases: ['สถานะใช้งาน', 'statusUse', 'status_use']
    },
    fullName: {
        label: 'ชื่อ-สกุล',
        required: false,
        aliases: ['ชื่อ-สกุล', 'fullName', 'fullname', 'ชื่อผู้รับบริการ']
    }
};

function normalizeHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[_-]+/g, '');
}

export function getMappingFields() {
    return Object.entries(FIELD_DEFINITIONS).map(([key, definition]) => ({
        key,
        label: definition.label,
        required: definition.required
    }));
}

export function inferExcelMapping(headers = []) {
    const normalizedHeaders = headers.map(header => ({
        raw: header,
        normalized: normalizeHeader(header)
    }));

    return Object.entries(FIELD_DEFINITIONS).reduce((mapping, [field, definition]) => {
        const found = normalizedHeaders.find(header =>
            definition.aliases.some(alias => normalizeHeader(alias) === header.normalized)
        );
        if (found) mapping[field] = found.raw;
        return mapping;
    }, {});
}

export function getMissingRequiredFields(mapping = {}) {
    return Object.entries(FIELD_DEFINITIONS)
        .filter(([, definition]) => definition.required)
        .filter(([field]) => !mapping[field])
        .map(([field, definition]) => ({ key: field, label: definition.label }));
}

export function normalizeExcelRows(rows = [], mapping = {}) {
    return rows.map(row => {
        const normalized = { ...row };
        Object.entries(mapping).forEach(([field, header]) => {
            if (header && Object.prototype.hasOwnProperty.call(row, header)) {
                normalized[field] = row[header];
            }
        });
        return normalized;
    });
}
