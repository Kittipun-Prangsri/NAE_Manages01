import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

// Test invoking the handler logic directly
async function simulateLineWebhook() {
    console.log("Simulating LINE Webhook for text: 'นำเข้าข้อมูล'...");

    const fakeEvent = {
        type: 'message',
        replyToken: 'dummy_token_123456',
        source: {
            type: 'group',
            groupId: process.env.LINE_GROUP_ID
        },
        message: {
            type: 'text',
            text: 'นำเข้าข้อมูล'
        }
    };

    // Import the server module or call fetch to line api directly
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetId = fakeEvent.source.groupId;
    const queryDate = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });

    console.log("Using Target Group ID:", targetId);
    console.log("Sending test summary Flex message...");

    const formattedDate = new Date(queryDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

    const flexBubble = {
        type: "bubble",
        size: "giga",
        body: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#18191a",
            contents: [
                {
                    type: "text",
                    text: "📊 สรุปข้อมูลการให้บริการ",
                    weight: "bold",
                    color: "#ffffff",
                    size: "xl"
                },
                {
                    type: "text",
                    text: `Dashboard Summary (${formattedDate}) • Local Test`,
                    size: "xs",
                    color: "#8c8c8c",
                    margin: "sm"
                },
                { type: "separator", margin: "md", color: "#333333" },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "box",
                            layout: "horizontal",
                            contents: [
                                { type: "text", text: "ทดสอบคำสั่ง 'นำเข้าข้อมูล'", color: "#52c41a", size: "sm", weight: "bold" }
                            ]
                        }
                    ]
                }
            ]
        }
    };

    const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            to: targetId,
            messages: [
                {
                    type: 'flex',
                    altText: `📊 สรุปข้อมูลการให้บริการ (${queryDate})`,
                    contents: flexBubble
                }
            ]
        })
    });

    const pushData = await pushRes.json().catch(() => ({}));
    console.log("Push Status:", pushRes.status);
    console.log("Push Result:", pushData);

    process.exit(0);
}

simulateLineWebhook();
