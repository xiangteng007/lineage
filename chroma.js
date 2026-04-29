require('dotenv').config();
const { ChromaClient } = require('chromadb');

// Initialize ChromaClient with Token Authentication
const chromaUrl = process.env.CHROMA_SERVER_URL || 'http://localhost:8000';
const urlObj = new URL(chromaUrl);

const chromaClientConfig = {
    host: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    ssl: urlObj.protocol === 'https:',
    headers: process.env.CHROMA_SERVER_TOKEN ? {
        Authorization: `Bearer ${process.env.CHROMA_SERVER_TOKEN}`
    } : {}
};

const chromaClient = new ChromaClient(chromaClientConfig);

/**
 * 取得或建立 Collection
 * @param {string} name 
 * @returns {Promise<any>}
 */
async function getOrCreateCollection(name) {
    try {
        return await chromaClient.getOrCreateCollection({ name });
    } catch (error) {
        console.error(`Error getting/creating Chroma collection [${name}]:`, error);
        throw error;
    }
}

/**
 * 新增文件到 Collection
 * @param {string} collectionName 
 * @param {string[]} ids 
 * @param {string[]} documents 
 * @param {object[]} metadatas 
 */
async function addData(collectionName, ids, documents, metadatas = []) {
    const collection = await getOrCreateCollection(collectionName);
    return await collection.add({
        ids,
        documents,
        metadatas: metadatas.length ? metadatas : undefined
    });
}

/**
 * 搜尋相似文件
 * @param {string} collectionName 
 * @param {string[]} queryTexts 
 * @param {number} nResults 
 */
async function queryData(collectionName, queryTexts, nResults = 5) {
    const collection = await getOrCreateCollection(collectionName);
    return await collection.query({
        queryTexts,
        nResults
    });
}

/**
 * 刪除文件
 * @param {string} collectionName 
 * @param {string[]} ids 
 */
async function deleteData(collectionName, ids) {
    const collection = await getOrCreateCollection(collectionName);
    return await collection.delete({
        ids
    });
}

module.exports = {
    chromaClient,
    getOrCreateCollection,
    addData,
    queryData,
    deleteData
};
