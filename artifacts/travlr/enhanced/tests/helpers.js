/**
 * test helpers 
 * 
 * Uses in memory database for testing
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';
 
const mongoose = require('mongoose');
require('../app_api/models/db'); // registers schemas + sanitizeFilter; no auto-connect under test
 
let memoryServer;
 
async function startDatabase(name) {
    let base = process.env.TEST_MONGODB_URI;
    if (!base) {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        memoryServer = await MongoMemoryServer.create();
        base = memoryServer.getUri();
    }
    await mongoose.connect(base, { dbName: `travlr_test_${name}_${process.pid}`, serverSelectionTimeoutMS: 5000 });
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
}
 
async function stopDatabase() {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    if (memoryServer) await memoryServer.stop();
}
 
const sampleTrips = () => ([
    { code: 'GALR210214', name: 'Gale Reef', length: '4 nights / 5 days', start: '2021-02-14T08:00:00Z',
      resort: 'Emerald Bay, 3 stars', perPerson: '799.00', image: 'reef1.jpg', description: '<p>Gale Reef</p>' },
    { code: 'DAWR210315', name: "Dawson's Reef", length: '4 nights / 5 days', start: '2021-03-15T08:00:00Z',
      resort: 'Blue Lagoon, 4 stars', perPerson: '1199.00', image: 'reef2.jpg', description: '<p>Dawson</p>' },
    { code: 'CLAR210621', name: 'Claire Reef', length: '4 nights / 5 days', start: '2021-06-21T08:00:00Z',
      resort: 'Coral Sands, 5 stars', perPerson: '1999.00', image: 'reef3.jpg', description: '<p>Claire</p>' },
    { code: 'EMBK210901', name: 'Emerald Kayak', length: '3 nights / 4 days', start: '2021-09-01T08:00:00Z',
      resort: 'Emerald Bay, 3 stars', perPerson: 601, image: 'kayak.jpg', description: '<p>Kayak</p>' }
]);
 
module.exports = { startDatabase, stopDatabase, sampleTrips };