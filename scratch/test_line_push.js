import dotenv from 'dotenv';

dotenv.config();

async function testLinePush() {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const groupId = process.env.LINE_GROUP_ID;

    console.log("Token:", token ? token.substring(0, 20) + "..." : "NONE");
    console.log("Group ID:", groupId);

    const payload = {
        to: groupId,
        messages: [
            {
                type: 'text',
                text: '🧪 [Test Message] Testing LINE Bot connection from system...'
            }
        ]
    };

    try {
        const response = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const resData = await response.json().catch(() => ({}));
        console.log("HTTP Status:", response.status);
        console.log("Response:", resData);
    } catch (err) {
        console.error("Fetch Error:", err);
    }

    process.exit(0);
}

testLinePush();
