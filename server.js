const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== AUTH CONFIG ======
const ADMIN_PASSWORD = 'shop1234';   // ⚠️ Your password
const sessions = new Map();          // stores active login tokens

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ====== AUTH MIDDLEWARE ======
function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (token && sessions.has(token)) {
        next();
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
}

// ====== LOGIN / LOGOUT ======
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        sessions.set(token, { createdAt: Date.now() });
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, error: 'Wrong password' });
    }
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) sessions.delete(token);
    res.json({ success: true });
});

// ====== SERVICES (PROTECTED) ======
app.get('/api/services', requireAuth, async (req, res) => {
    try {
        const services = await db.getServices();
        res.json(services);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/services', requireAuth, async (req, res) => {
    const { name, price, unit } = req.body;
    if (!name || !price || !unit) {
        return res.status(400).json({ error: "Missing name, price, or unit" });
    }
    try {
        const id = await db.addService(name, parseFloat(price), unit);
        res.json({ message: "Service added", id: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/services/:id', requireAuth, async (req, res) => {
    try {
        await db.deleteService(req.params.id);
        res.json({ message: "Service deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====== CHECKOUT (PROTECTED) ======
app.post('/api/checkout', requireAuth, async (req, res) => {
    const { customer, total, cartItems } = req.body;
    try {
        const orderId = await db.saveOrder(customer, total, cartItems);
        res.json({ message: "Order saved successfully!", orderId: orderId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ====== DASHBOARD (PROTECTED) ======
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = await db.pool.query(
            "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE date LIKE $1",
            [today + '%']
        );
        const allTime = await db.pool.query(
            "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders"
        );
        const pending = await db.pool.query(
            "SELECT COUNT(*) AS count FROM orders WHERE payment_status = 'Pending'"
        );
        const topServices = await db.pool.query(
            "SELECT service_name, SUM(quantity) AS total_qty, SUM(quantity * price) AS total_revenue " +
            "FROM order_items GROUP BY service_name ORDER BY total_qty DESC LIMIT 5"
        );
        const recentOrders = await db.pool.query(
            "SELECT id, date, customer, total, payment_status FROM orders ORDER BY id DESC LIMIT 10"
        );
        const weekly = await db.pool.query(
            "SELECT DATE(date) AS day, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue " +
            "FROM orders WHERE date >= NOW() - INTERVAL '7 days' " +
            "GROUP BY DATE(date) ORDER BY day ASC"
        );
        res.json({
            today: { orders: parseInt(todayOrders.rows[0].count), revenue: parseFloat(todayOrders.rows[0].revenue) },
            allTime: { orders: parseInt(allTime.rows[0].count), revenue: parseFloat(allTime.rows[0].revenue) },
            pending: parseInt(pending.rows[0].count),
            topServices: topServices.rows,
            recentOrders: recentOrders.rows,
            weekly: weekly.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});