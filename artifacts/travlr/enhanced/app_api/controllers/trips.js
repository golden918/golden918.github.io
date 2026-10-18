/**
 * Enhancements
 * - Every handler is wrapped in a try-catch block
 * - Database errors are handled and translated into user-friendly messages
 * - GET /trips no longer runs an unbounded find. 
 * - Writes only accept whitelisted fields and updates run schema validators.
 * - New GET /trips/stats aggregation endpoint and protected DELETE. 
 */

const mongoose = require('mongoose');
const Trip = require('../models/travlr');
const {
    buildFilter, buildSort, buildPagination, LIST_PROJECTION
} = require('../lib/tripQuery');
const { buildStatsPipelines } = require('../lib/tripStats')

const pickWritable = (body = {}) => {
    const out = [];
    for (const field of Trip.WRITABLE_FIELDS) {
        if (body[field] !== undefined) {
            out[field] = body[field];
        }
    }
    return out;
};

const normalizeCode = (code) => String(code || '').toUpperCase();

// Translate known database errors into user-friendly messages
const handleDbError = (err, res) => {
    if (err.name === 'ValidationError') {
        const errors = Object.fromEntries(
            Object.entries(err.errors).map(([k, v]) => [k, v.message])
        );
        res.status(400).json({ message: "Validation failed", errors });
        return true;
    }
    if (err.code === 11000) {
        res.status(409).json({ message: "A trip with this code already exists" });
        return true;
    }
};

// GET /api/trips?resort=&q=&startFrom=&startTo=&minPrice=&maxPrice=&sort=&page=&limit=
const tripsList = async (req, res, next) => {
    const errors = [];
    const filter = buildFilter(req.query, errors);
    const sort = buildSort(req.query, errors);
    const { page, limit, skip } = buildPagination(req.query, errors);
    if (errors.length) return res.status(400).json({ message: 'Invalid query', errors });
 
    try {
        // Count and page fetch run concurrently; both can use the same indexes
        const [total, trips] = await Promise.all([
            Trip.countDocuments(filter).exec(),
            Trip.find(filter)
                .select(LIST_PROJECTION)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean()
                .exec()
        ]);
 
        res.set({
            'X-Total-Count': String(total),
            'X-Page': String(page),
            'X-Limit': String(limit),
            'X-Total-Pages': String(Math.max(1, Math.ceil(total / limit)))
        });
        // An empty page is a valid result, not an error
        return res.status(200).json(trips);
    } catch (err) {
        return handleDbError(err, res) || next(err);
    }
};
 
// GET /api/trips/stats - per-resort pricing report built with the aggregation pipeline
// Accepts the same filters as the list endpoint.
const tripsStats = async (req, res, next) => {
    const errors = [];
    const filter = buildFilter(req.query, errors);
    if (errors.length) return res.status(400).json({ message: 'Invalid query', errors });
 
    try {
        const { byResortPipeline, overallPipeline } = buildStatsPipelines(filter);
        const [byResort, overallRows] = await Promise.all([
            Trip.aggregate(byResortPipeline).exec(),
            Trip.aggregate(overallPipeline).exec()
        ]);
 
        const overall = overallRows[0] ||
            { tripCount: 0, avgPrice: null, minPrice: null, maxPrice: null };
        return res.status(200).json({ overall, byResort });
    } catch (err) {
        return handleDbError(err, res) || next(err);
    }
};
 
// GET /api/trips/:tripCode
const tripsFindByCode = async (req, res, next) => {
    try {
        const trip = await Trip.findOne({ code: normalizeCode(req.params.tripCode) })
            .select(LIST_PROJECTION)
            .lean()
            .exec();
        if (!trip) return res.status(404).json({ message: 'Trip code not found' });
        return res.status(200).json(trip);
    } catch (err) {
        return handleDbError(err, res) || next(err);
    }
};
 
// POST /api/trips  (JWT required)
const tripsAddTrip = async (req, res, next) => {
    try {
        const trip = await Trip.create(pickWritable(req.body));
        return res.status(201).json(trip);
    } catch (err) {
        return handleDbError(err, res) || next(err);
    }
};
 
// PUT /api/trips/:tripCode  (JWT required)
const tripsUpdateTrip = async (req, res, next) => {
    const update = pickWritable(req.body);
    if (!Object.keys(update).length) {
        return res.status(400).json({ message: 'No updatable fields supplied' });
    }
    try {
        const trip = await Trip.findOneAndUpdate(
            { code: normalizeCode(req.params.tripCode) },
            { $set: update },
            { new: true, runValidators: true, context: 'query' }
        ).exec();
        if (!trip) return res.status(404).json({ message: 'Trip code not found' });
        return res.status(200).json(trip);
    } catch (err) {
        return handleDbError(err, res) || next(err);
    }
};
 
// DELETE /api/trips/:tripCode  (JWT required)
const tripsDeleteTrip = async (req, res, next) => {
    try {
        const result = await Trip.deleteOne({ code: normalizeCode(req.params.tripCode) }).exec();
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Trip code not found' });
        return res.status(204).end();
    } catch (err) {
        return next(err);
    }
};
 
module.exports = {
    tripsList,
    tripsStats,
    tripsFindByCode,
    tripsAddTrip,
    tripsUpdateTrip,
    tripsDeleteTrip
};