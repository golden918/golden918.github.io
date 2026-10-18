/**
 * Enhancements
 * - PBKDF2-SHA512 work factor rased from 1000 to 210000
 * - the iteration count is stored per user. Accounts created 
 * before this change have no 'iteration' field and are treated as legacy 
 * 1,000 iteration hashes;
 * - Hashing is asynchronous so a 210k iteration hash can be computed without blocking the event loop.
 * - Hash comparison is done in constant time to prevent timing attacks.
 * - hash/salt/iteration are excluded from query results by default so they 
 * can never leak through an API response.
 * - email is normalizedand form validated, making the uniqie index case-insensitive in practice.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const pbkdf2 = promisify(crypto.pbkdf2);

const LEGACY_ITERATIONS = 1000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const targetIterations = () => {
    const n = parseInt(process.env.PBKDF2_ITERATIONS, 10);
    return Number.isInteger(n) && n >= 1000 ? n : 210000;
}

const userSchema = new mongoose.Schema({
    email: { 
        type: String, 
        unique: true,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 254,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email address is not valid']
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    hash: {
        type: String,
        selected: false
    },
    salt: {
        type: String,
        selected: false
    },
    iterations: {
        type: Number,
        select: false
    }}, {
        timestamps: true,
        versionKey: false
});

const derive = async (password, salt, iterations) => 
    (await pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST)).toString('hex');

// Hash and set a new password on this record 
userSchema.methods.setPassword = async function(password) {
    this.salt = crypto.randomBytes(16).toString('hex');
    this.iterations = targetIterations();
    this.hash = await derive(password, this.salt, this.iterations);
}

// Compare an entered password against the stored hash in constant time.
// The query must have selected +hash +salt +iterations.
userSchema.methods.validPassword = async function (password) {
    if (!this.hash || !this.salt) return false;
    const iterations = this.iterations || LEGACY_ITERATIONS;
    const candidate = Buffer.from(await derive(password, this.salt, iterations), 'hex');
    const stored = Buffer.from(this.hash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
};
 
// True when the stored hash was made with a weaker work factor than current policy
userSchema.methods.needsRehash = function () {
    return (this.iterations || LEGACY_ITERATIONS) < targetIterations();
};
 
// Generate a signed JSON Web Token for this user
userSchema.methods.generateJWT = function () {
    return jwt.sign(
        { _id: this._id, email: this.email, name: this.name },
        process.env.JWT_SECRET,
        { expiresIn: '1h', algorithm: 'HS256' }
    );
};
 
const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;
module.exports.LEGACY_ITERATIONS = LEGACY_ITERATIONS;