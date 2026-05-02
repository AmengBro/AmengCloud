const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const API_KEY = 'PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ';
const BASE_ID = 'bseloUQsS6clyMZgVMK';
const TABLE_ID = 'x0612PXRor';
const CHUNK_TABLE_ID = 'lPC8BdINUq';

function makeRequest(path, method) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'data.520ai.cc',
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-bm-token': API_KEY
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => responseBody += chunk);
            res.on('end', () => {
                resolve({ status: res.statusCode, body: responseBody });
            });
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

async function testDownload() {
    console.log('========== 测试下载流程 ==========\n');

    // 找到分片存储的文件
    const fileResult = await makeRequest(
        `/api/bases/${BASE_ID}/tables/${TABLE_ID}/records/70`,
        'GET'
    );

    if (fileResult.status !== 200) {
        console.log('获取文件失败');
        return;
    }

    const fileData = JSON.parse(fileResult.body);
    console.log(`文件: ${fileData.name}`);
    console.log(`base64字段: ${fileData.base64}`);

    // 解析分片IDs
    const chunkIds = JSON.parse(fileData.base64);
    console.log(`分片IDs: [${chunkIds.join(', ')}]`);

    // 获取所有分片
    let compressedBase64 = '';
    for (const chunkId of chunkIds) {
        const chunkResult = await makeRequest(
            `/api/bases/${BASE_ID}/tables/${CHUNK_TABLE_ID}/records/${chunkId}`,
            'GET'
        );

        if (chunkResult.status === 200) {
            const chunkData = JSON.parse(chunkResult.body);
            compressedBase64 += chunkData.name;
            console.log(`获取分片 ${chunkId} 成功，大小: ${chunkData.name.length} bytes`);
        }
    }

    console.log(`\n拼接完成，压缩数据大小: ${compressedBase64.length} bytes`);

    // 解压数据
    console.log('开始解压...');
    const compressedBuffer = Buffer.from(compressedBase64, 'base64');
    const decompressedBuffer = zlib.gunzipSync(compressedBuffer);
    const base64Data = decompressedBuffer.toString('base64');
    console.log(`解压完成，原始base64大小: ${base64Data.length} bytes`);

    // 解码并保存文件
    console.log('解码base64并保存...');
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`解码后的二进制大小: ${buffer.length} bytes`);

    // 检查前几个字节是否是PNG文件头
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const isPng = buffer.slice(0, 8).equals(pngHeader);
    console.log(`是否为PNG文件: ${isPng}`);

    // 保存文件
    const savePath = path.join(__dirname, 'test_download_output.png');
    fs.writeFileSync(savePath, buffer);
    console.log(`\n文件已保存到: ${savePath}`);
    console.log(`文件大小: ${buffer.length} bytes`);
}

testDownload().catch(console.error);