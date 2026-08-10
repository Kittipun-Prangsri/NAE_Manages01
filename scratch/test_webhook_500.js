import handler from '../api/line/webhook.js';

async function testWebhookHandler() {
    const req = {
        method: 'POST',
        headers: {},
        body: {
            destination: 'xxxxxxxxxx',
            events: [
                {
                    replyToken: '00000000000000000000000000000000',
                    type: 'message',
                    timestamp: 1562641416800,
                    source: {
                        type: 'user',
                        userId: 'U4af4980629...'
                    },
                    message: {
                        id: '325708',
                        type: 'text',
                        text: 'Hello, world'
                    }
                }
            ]
        }
    };

    const res = {
        setHeader: (k, v) => console.log(`Header: ${k} = ${v}`),
        status: (code) => {
            console.log(`Status Code: ${code}`);
            return {
                json: (obj) => console.log('JSON:', obj),
                send: (msg) => console.log('Send:', msg),
                end: () => console.log('End')
            };
        }
    };

    console.log("Testing handler with LINE verification payload...");
    try {
        await handler(req, res);
    } catch (err) {
        console.error("HANDLER CRASHED WITH ERROR:", err);
    }

    process.exit(0);
}

testWebhookHandler();
