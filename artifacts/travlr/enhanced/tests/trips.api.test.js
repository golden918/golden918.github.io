const { startDatabase, stopDatabase, sampleTrips } = require('./helpers');
const request = require('supertest');
const app = require('../app');
const Trip = require('../app_api/models/travlr');
const User = require('../app_api/models/user');
 
let token;
const auth = () => ({ Authorization: `Bearer ${token}` });
 
beforeAll(async () => {
    await startDatabase('trips');
    const admin = new User({ name: 'Admin', email: 'admin@travlr.com' });
    await admin.setPassword('correct horse');
    await admin.save();
    token = admin.generateJWT();
});
afterAll(stopDatabase);
beforeEach(async () => {
    await Trip.deleteMany({});
    await Trip.insertMany(sampleTrips());
});
 
describe('Trip schema', () => {
    test('stores perPerson as a Number (string input is converted)', async () => {
        const raw = await Trip.collection.findOne({ code: 'GALR210214' });
        expect(raw.perPerson).toBe(799);
        expect(typeof raw.perPerson).toBe('number');
    });
 
    test('defines unique code index and the query-pattern indexes', async () => {
        const indexes = await Trip.collection.indexes();
        const byName = Object.fromEntries(indexes.map(i => [i.name, i]));
        expect(byName.code_1.unique).toBe(true);
        expect(byName.resort_1_start_1.key).toEqual({ resort: 1, start: 1 });
        expect(byName.start_1).toBeDefined();
        expect(byName.perPerson_1).toBeDefined();
    });
 
    test('rejects malformed codes, negative prices and bad image names', async () => {
        const bad = new Trip({ ...sampleTrips()[0], code: 'bad', perPerson: -1, image: '../../etc/passwd' });
        const err = bad.validateSync();
        expect(Object.keys(err.errors).sort()).toEqual(['code', 'image', 'perPerson']);
    });
});
 
describe('GET /api/trips', () => {
    test('returns a plain array plus pagination headers', async () => {
        const res = await request(app).get('/api/trips').expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(4);
        expect(res.headers['x-total-count']).toBe('4');
        expect(res.headers['x-total-pages']).toBe('1');
        expect(res.headers['access-control-expose-headers']).toMatch(/X-Total-Count/);
    });
 
    test('default sort is by start date ascending', async () => {
        const res = await request(app).get('/api/trips').expect(200);
        expect(res.body.map(t => t.code)).toEqual(['GALR210214', 'DAWR210315', 'CLAR210621', 'EMBK210901']);
    });
 
    test('paginates with page/limit', async () => {
        const res = await request(app).get('/api/trips?limit=3&page=2').expect(200);
        expect(res.body.map(t => t.code)).toEqual(['EMBK210901']);
        expect(res.headers['x-total-pages']).toBe('2');
        expect(res.headers['x-page']).toBe('2');
    });
 
    test('filters by resort (case-insensitive prefix) and date range', async () => {
        const res = await request(app)
            .get('/api/trips?resort=emerald&startFrom=2021-03-01').expect(200);
        expect(res.body.map(t => t.code)).toEqual(['EMBK210901']);
    });
 
    test('filters and sorts by numeric price', async () => {
        const res = await request(app).get('/api/trips?minPrice=700&maxPrice=1500&sort=-price').expect(200);
        expect(res.body.map(t => t.perPerson)).toEqual([1199, 799]);
    });
 
    test('searches by name', async () => {
        const res = await request(app).get('/api/trips?q=reef').expect(200);
        expect(res.body).toHaveLength(3);
    });
 
    test('projection omits internal fields', async () => {
        const res = await request(app).get('/api/trips?limit=1').expect(200);
        expect(res.body[0]).not.toHaveProperty('createdAt');
        expect(res.body[0]).not.toHaveProperty('__v');
    });
 
    test('invalid parameters return 400 with reasons', async () => {
        const res = await request(app).get('/api/trips?sort=hash&minPrice=abc').expect(400);
        expect(res.body.errors).toHaveLength(2);
    });
 
    test('operator-injection in the query string is neutralized', async () => {
        const res = await request(app).get('/api/trips?resort[$ne]=x').expect(200);
        expect(res.body).toHaveLength(4); // treated as "no resort filter", not as a $ne query
    });
 
    test('an empty result is 200 with an empty array, not 404', async () => {
        const res = await request(app).get('/api/trips?resort=Nowhere').expect(200);
        expect(res.body).toEqual([]);
        expect(res.headers['x-total-count']).toBe('0');
    });
});
 
describe('GET /api/trips/stats (aggregation)', () => {
    test('groups by resort with count/avg/min/max price, highest average first', async () => {
        const res = await request(app).get('/api/trips/stats').expect(200);
        expect(res.body.overall).toEqual({ tripCount: 4, avgPrice: 1149.5, minPrice: 601, maxPrice: 1999 });
        expect(res.body.byResort.map(r => r.resort)).toEqual(
            ['Coral Sands, 5 stars', 'Blue Lagoon, 4 stars', 'Emerald Bay, 3 stars']);
        const emerald = res.body.byResort.find(r => r.resort.startsWith('Emerald'));
        expect(emerald).toMatchObject({ tripCount: 2, avgPrice: 700, minPrice: 601, maxPrice: 799 });
        expect(new Date(emerald.nextStart).toISOString()).toBe('2021-02-14T08:00:00.000Z');
    });
 
    test('accepts the same filters as the list endpoint', async () => {
        const res = await request(app).get('/api/trips/stats?maxPrice=1000').expect(200);
        expect(res.body.overall.tripCount).toBe(2);
        expect(res.body.byResort).toHaveLength(1);
    });
 
    test('empty match returns zero counts instead of failing', async () => {
        const res = await request(app).get('/api/trips/stats?resort=Nowhere').expect(200);
        expect(res.body.overall.tripCount).toBe(0);
        expect(res.body.byResort).toEqual([]);
    });
});
 
describe('GET /api/trips/:tripCode', () => {
    test('finds a trip (code lookup is case-insensitive)', async () => {
        const res = await request(app).get('/api/trips/galr210214').expect(200);
        expect(res.body.name).toBe('Gale Reef');
    });
 
    test('404 for an unknown code', async () => {
        await request(app).get('/api/trips/ZZZZ999999').expect(404);
    });
});
 
describe('POST /api/trips', () => {
    const newTrip = () => ({ ...sampleTrips()[0], code: 'NEWT220101', name: 'New Trip' });
 
    test('requires a valid JWT', async () => {
        await request(app).post('/api/trips').send(newTrip()).expect(401);
        await request(app).post('/api/trips').set('Authorization', 'Bearer not.a.token').send(newTrip()).expect(401);
        expect(await Trip.countDocuments({ code: 'NEWT220101' })).toBe(0);
    });
 
    test('creates a trip and ignores non-whitelisted fields', async () => {
        const res = await request(app).post('/api/trips').set(auth())
            .send({ ...newTrip(), _id: '000000000000000000000000', admin: true }).expect(201);
        expect(res.body.code).toBe('NEWT220101');
        expect(res.body._id).not.toBe('000000000000000000000000');
        expect(res.body).not.toHaveProperty('admin');
    });
 
    test('duplicate code -> 409 (unique index), not a crash', async () => {
        const res = await request(app).post('/api/trips').set(auth())
            .send({ ...newTrip(), code: 'GALR210214' }).expect(409);
        expect(res.body.message).toMatch(/already exists/);
    });
 
    test('validation failure -> 400 with per-field messages (was a ReferenceError)', async () => {
        const res = await request(app).post('/api/trips').set(auth())
            .send({ code: 'bad', name: 'x' }).expect(400);
        expect(res.body.errors).toHaveProperty('code');
        expect(res.body.errors).toHaveProperty('perPerson');
    });
 
    test('malformed JSON -> 400 JSON response', async () => {
        const res = await request(app).post('/api/trips').set(auth())
            .set('Content-Type', 'application/json').send('{"code":').expect(400);
        expect(res.body.message).toBe('Malformed JSON body');
    });
});
 
describe('PUT /api/trips/:tripCode', () => {
    test('updates and returns the updated document', async () => {
        const res = await request(app).put('/api/trips/GALR210214').set(auth())
            .send({ perPerson: '849.50', name: 'Gale Reef Deluxe' }).expect(200);
        expect(res.body.perPerson).toBe(849.5);
        expect(res.body.name).toBe('Gale Reef Deluxe');
    });
 
    test('runs schema validators on update', async () => {
        await request(app).put('/api/trips/GALR210214').set(auth()).send({ perPerson: -10 }).expect(400);
        const t = await Trip.findOne({ code: 'GALR210214' }).lean();
        expect(t.perPerson).toBe(799);
    });
 
    test('404 for unknown code (was a ReferenceError)', async () => {
        await request(app).put('/api/trips/ZZZZ999999').set(auth()).send({ name: 'x' }).expect(404);
    });
 
    test('changing code to an existing one -> 409', async () => {
        await request(app).put('/api/trips/GALR210214').set(auth()).send({ code: 'DAWR210315' }).expect(409);
    });
});
 
describe('DELETE /api/trips/:tripCode', () => {
    test('requires JWT, deletes, then 404s', async () => {
        await request(app).delete('/api/trips/GALR210214').expect(401);
        await request(app).delete('/api/trips/GALR210214').set(auth()).expect(204);
        await request(app).delete('/api/trips/GALR210214').set(auth()).expect(404);
    });
});