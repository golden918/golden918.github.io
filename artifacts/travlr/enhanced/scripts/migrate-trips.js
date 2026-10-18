/**
 * NEW FILE 
 * One time migration script for updating trip documents.
 *  npm run migrate
 * 
 * 1. Converts perPerson from string to number
 * 2. Normalizes trip codes to uppercase and trims them.
 * 3. Detects duplicate trip codes with an aggregation. The unique 
 * index cannot be built while duplicates exist, so the script stops and lists them.
 * 4. Syncronizes indexes with the schema
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('../app_api/models/db');
const Trip = require('../app_api/models/travlr');
 
async function migrate() {
    await mongoose.connection.asPromise();
    const col = Trip.collection; // native driver: bypasses schema casting on read
 
    // 1 + 2: fix field types/format document by document, in one bulk write
    const ops = [];
    const cursor = col.find({}, { projection: { code: 1, perPerson: 1 } });
    for await (const doc of cursor) {
        const set = {};
        if (typeof doc.perPerson === 'string') {
            const n = Number(doc.perPerson.replace(/[$,\s]/g, ''));
            if (!Number.isFinite(n)) {
                throw new Error(`Trip ${doc.code}: perPerson "${doc.perPerson}" is not a number`);
            }
            set.perPerson = n;
        }
        if (typeof doc.code === 'string' && doc.code !== doc.code.trim().toUpperCase()) {
            set.code = doc.code.trim().toUpperCase();
        }
        if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
    }
    if (ops.length) await col.bulkWrite(ops, { ordered: true });
    console.log(`Converted ${ops.length} trip document(s)`);
 
    // 3: duplicates would make the unique index build fail
    const dupes = await col.aggregate([
        { $group: { _id: '$code', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();
    if (dupes.length) {
        console.error('Duplicate trip codes must be resolved before the unique index can be created:');
        dupes.forEach(d => console.error(`  ${d._id} (${d.count} documents)`));
        process.exitCode = 1;
        return;
    }
 
    // 4: indexes
    const dropped = await Trip.syncIndexes();
    const indexes = await col.indexes();
    console.log(`Dropped stale indexes: ${dropped.length ? dropped.join(', ') : 'none'}`);
    console.log('Current indexes:', indexes.map(i => `${i.name}${i.unique ? ' (unique)' : ''}`).join(', '));
}
 
migrate()
    .catch(err => { console.error('Migration failed:', err.message); process.exitCode = 1; })
    .finally(async () => {
        await mongoose.connection.close();
        process.exit();
    });