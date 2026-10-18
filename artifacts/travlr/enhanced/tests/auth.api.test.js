const { startDatabase, stopDatabase } = require('./helpers');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../app');
const User = require('../app_api/models/user');
const Trip = require('../app_api/models/travlr');
 
beforeAll(() => startDatabase('auth'));
afterAll(stopDatabase);
beforeEach(() => User.deleteMany({}));
 
describe('POST /api/register', () => {
    test('creates the user and returns a usable JWT (was: undefined token crash)', async () => {
        const res = await request(app).post('/api/register')
            .send({ name: 'Caleb', email: 'Caleb@Travlr.com', password: 'longenough' }).expect(201);
        const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
        expect(payload.email).toBe('caleb@travlr.com'); // normalized
    });
 
    test('stores a 210k-iteration PBKDF2 hash and never returns it', async () => {
        await request(app).post('/api/register')
            .send({ name: 'A', email: 'a@travlr.com', password: 'longenough' }).expect(201);
        const raw = await User.collection.findOne({ email: 'a@travlr.com' });
        expect(raw.iterations).toBe(210000);
        expect(raw.hash).toHaveLength(128);
        const viaModel = await User.findOne({ email: 'a@travlr.com' }).lean();
        expect(viaModel.hash).toBeUndefined();
        expect(viaModel.salt).toBeUndefined();
    });
 
    test('duplicate email (any case) -> 409', async () => {
        await request(app).post('/api/register').send({ name: 'A', email: 'dup@travlr.com', password: 'longenough' });
        await request(app).post('/api/register').send({ name: 'B', email: 'DUP@travlr.com', password: 'longenough' }).expect(409);
    });
 
    test('missing fields, short passwords and bad emails -> 400', async () => {
        await request(app).post('/api/register').send({ email: 'x@y.com' }).expect(400);
        await request(app).post('/api/register').send({ name: 'x', email: 'x@y.com', password: 'short' }).expect(400);
        await request(app).post('/api/register').send({ name: 'x', email: 'nope', password: 'longenough' }).expect(400);
    });
});
 
describe('POST /api/login', () => {
    beforeEach(async () => {
        const u = new User({ name: 'Admin', email: 'admin@travlr.com' });
        await u.setPassword('correct horse');
        await u.save();
    });
 
    test('valid credentials return a JWT', async () => {
        const res = await request(app).post('/api/login')
            .send({ email: 'admin@travlr.com', password: 'correct horse' }).expect(200);
        expect(res.body.token).toBeDefined();
    });
 
    test('wrong password and unknown email get the same 401 message', async () => {
        const a = await request(app).post('/api/login').send({ email: 'admin@travlr.com', password: 'wrong' }).expect(401);
        const b = await request(app).post('/api/login').send({ email: 'nobody@travlr.com', password: 'wrong' }).expect(401);
        expect(a.body).toEqual(b.body);
    });
 
    test('NoSQL operator injection in login is rejected', async () => {
        await request(app).post('/api/login')
            .send({ email: { $ne: null }, password: 'correct horse' }).expect(401);
    });
 
    test('legacy 1,000-iteration hashes still log in and are upgraded transparently', async () => {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync('legacyPass1', salt, 1000, 64, 'sha512').toString('hex');
        await User.collection.insertOne({ name: 'Old', email: 'old@travlr.com', hash, salt }); // original schema shape
 
        await request(app).post('/api/login').send({ email: 'old@travlr.com', password: 'legacyPass1' }).expect(200);
 
        const upgraded = await User.collection.findOne({ email: 'old@travlr.com' });
        expect(upgraded.iterations).toBe(210000);
        expect(upgraded.hash).not.toBe(hash);
        await request(app).post('/api/login').send({ email: 'old@travlr.com', password: 'legacyPass1' }).expect(200);
    });
});
 
describe('authenticateJWT middleware (auth-bypass regression)', () => {
    const trip = {
        code: 'SECR220101', name: 'Should Not Exist', length: '1 night', start: '2022-01-01',
        resort: 'Nowhere', perPerson: 1, image: 'reef1.jpg', description: 'x'
    };
    afterEach(() => Trip.deleteMany({}));
 
    test.each([
        ['no header', {}],
        ['wrong scheme', { Authorization: 'Basic abc' }],
        ['garbage token', { Authorization: 'Bearer garbage' }],
        ['wrong secret', { Authorization: 'Bearer ' + jwt.sign({ _id: 1 }, 'not-the-secret') }],
        ['expired', { Authorization: 'Bearer ' + jwt.sign({ _id: 1 }, process.env.JWT_SECRET, { expiresIn: -10 }) }],
        ['alg none', { Authorization: 'Bearer ' + jwt.sign({ _id: 1 }, null, { algorithm: 'none' }) }]
    ])('%s -> 401 and the controller never runs', async (_label, headers) => {
        await request(app).post('/api/trips').set(headers).send(trip).expect(401);
        expect(await Trip.countDocuments({ code: 'SECR220101' })).toBe(0);
    });
});
 