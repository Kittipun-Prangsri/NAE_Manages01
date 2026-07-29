// state.js
export const LIVE_DASHBOARD_REFRESH_MS = 30000;
export const TRACKER_PAGE_SIZE = 20;

export const TRACKER_COLUMN_FILTERS = [
    { field: 'vn', label: 'VN' },
    { field: 'cid', label: 'เลขบัตรประชาชน' },
    { field: 'pttype', label: 'PTType', help: 'ประเภทสิทธิการรักษา' },
    { field: 'pcode', label: 'HIPDATA', help: 'รหัสกลุ่มสิทธิที่ใช้ตรวจสอบข้อมูล' },
    { field: 'authCode', label: 'Auth Code (HOS)', help: 'รหัสยืนยันตัวตนจาก HOSxP' },
    { field: 'claim_code', label: 'Claim Code (HOS)', help: 'รหัสเคลมที่บันทึกใน HOSxP' },
    { field: 'nhso_claim_code', label: 'Claim Code (Temp Authen)', help: 'รหัสเคลมจากข้อมูล Temp Authen ของ สปสช.' },
    { field: 'authen_code_type', label: 'Authen Type', help: 'ประเภทการยืนยันตัวตน' },
    { field: 'pttype_note', label: 'PTType Note' },
    { field: 'staff', label: 'เจ้าหน้าที่' },
    { field: 'check_claimcode', label: 'ผลการเช็ค' },
    { field: 'issue_reason', label: 'สาเหตุที่ต้องแก้' },
    { field: 'department', label: 'Department' }
];

const getInitialState = () => {
    if (typeof localStorage === 'undefined') {
        return {
            token: null,
            user: null,
            rawTableData: [],
            lgoTableData: [],
            savedQueries: [],
            queryHistory: [],
            currentQueryResults: [],
            hosxpStats: null,
            querySortBy: '',
            querySortDesc: false,
            trackerSortBy: '',
            trackerSortDesc: false,
            trackerSearchFilter: '',
            trackerColumnFilters: {},
            trackerDashboardFilter: null,
            trackerCurrentPage: 1,
            isTvMode: false,
            groupInsightsBy: 'department',
            excelMapping: null,
            excelHeaders: [],
            excelMappingFields: [],
            pendingExcelMappingResolve: null,
            hipdataCodes: []
        };
    }
    return {
        token: localStorage.getItem('nhso_token'),
        user: JSON.parse(localStorage.getItem('nhso_user')),
        rawTableData: [],
        lgoTableData: [],
        savedQueries: [],
        queryHistory: [],
        currentQueryResults: [],
        hosxpStats: null,
        querySortBy: '',
        querySortDesc: false,
        trackerSortBy: '',
        trackerSortDesc: false,
        trackerSearchFilter: '',
        trackerColumnFilters: {},
        trackerDashboardFilter: null,
        trackerCurrentPage: 1,
        liveDashboardInterval: null,
        liveDashboardCountdownInterval: null,
        liveDashboardNextRefreshAt: null,
        isTvMode: localStorage.getItem('live_tv_mode') === 'true',
        groupInsightsBy: localStorage.getItem('group_insights_by') || 'department',
        excelMapping: null,
        excelHeaders: [],
        excelMappingFields: [],
        pendingExcelMappingResolve: null,
        hipdataCodes: []
    };
};

export let appState = getInitialState();
export let isLoggingOut = { value: false };
export let activeColumnFilterField = { value: null };

// ตัวแปรอ้างอิง DOM
export const domRefs = {
    visitDateInput: null,
    excelFileInput: null
};
