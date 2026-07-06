import { captureAndNotify } from './capture-grafana.js';

console.log('🧪 Starting Manual Test Capture of Grafana Dashboard...');
console.time('Test Execution Time');

captureAndNotify().then((result) => {
    console.timeEnd('Test Execution Time');
    if (result && result.success) {
        console.log('🎉 TEST SUCCESSFUL!');
        console.log(`Saved screenshot path: ${result.filepath}`);
        console.log(`Filename: ${result.filename}`);
    } else {
        console.error('❌ TEST FAILED!');
        console.error('Error detail:', result ? result.error : 'Unknown error');
    }
    process.exit(result && result.success ? 0 : 1);
}).catch((err) => {
    console.timeEnd('Test Execution Time');
    console.error('❌ Unhandled exception during test:', err);
    process.exit(1);
});
