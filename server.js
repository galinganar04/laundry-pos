const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = 'shop1234';
const sessions = new Map();

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ limit: '5mb', extended: true }));
app.use(express.static('public'));

function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'];
    if (token && sessions.has(token)) next();
    else res.status(401).json({ error: 'Not authenticated' });
}

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

// SERVICES
app.get('/api/services', requireAuth, async (req, res) => {
    try { res.json(await db.getServices()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/services', requireAuth, async (req, res) => {
    const { name, price, unit } = req.body;
    if (!name || !price || !unit) return res.status(400).json({ error: "Missing fields" });
    try { const id = await db.addService(name, parseFloat(price), unit); res.json({ message: "Service added", id }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/services/:id', requireAuth, async (req, res) => {
    try { await db.deleteService(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// CHECKOUT
app.post('/api/checkout', requireAuth, async (req, res) => {
    const { customer, total, cartItems, paymentStatus, cashierName } = req.body;
    try { const orderId = await db.saveOrder(customer, total, cartItems, paymentStatus, cashierName); res.json({ message: "Order saved successfully!", orderId }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ORDERS
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const { filter = 'all', search = '', dateFrom = '', dateTo = '' } = req.query;
        res.json(await db.getOrders(filter, search, dateFrom, dateTo));
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/orders/:id/details', requireAuth, async (req, res) => {
    try {
        const orderResult = await db.pool.query("SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name FROM orders WHERE id = $1", [req.params.id]);
        if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
        const itemsResult = await db.pool.query("SELECT service_name, quantity, price FROM order_items WHERE order_id = $1", [req.params.id]);
        const order = orderResult.rows[0];
        order.items = itemsResult.rows;
        res.json(order);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/orders/:id/pay', requireAuth, async (req, res) => {
    try { await db.markAsPaid(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/orders/:id/unpay', requireAuth, async (req, res) => {
    try { await db.markAsUnpaid(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/orders/:id/status', requireAuth, async (req, res) => {
    const { status } = req.body;
    const validStatuses = ['Received', 'Washing', 'Drying', 'Ready', 'Picked Up'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try { await db.updateOrderStatus(req.params.id, status); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/orders/:id', requireAuth, async (req, res) => {
    try { await db.deleteOrder(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// BATCH
app.post('/api/orders/batch/status', requireAuth, async (req, res) => {
    const { ids, status } = req.body;
    const validStatuses = ['Received', 'Washing', 'Drying', 'Ready', 'Picked Up'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No orders selected' });
    try { for (const id of ids) await db.updateOrderStatus(id, status); res.json({ success: true, count: ids.length }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/orders/batch/pay', requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No orders selected' });
    try { for (const id of ids) await db.markAsPaid(id); res.json({ success: true, count: ids.length }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/orders/batch/unpay', requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No orders selected' });
    try { for (const id of ids) await db.markAsUnpaid(id); res.json({ success: true, count: ids.length }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/orders/batch/delete', requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No orders selected' });
    try { for (const id of ids) await db.deleteOrder(id); res.json({ success: true, count: ids.length }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// CUSTOMERS
app.get('/api/customers', requireAuth, async (req, res) => {
    try { res.json(await db.getCustomers(req.query.search || '')); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/:id', requireAuth, async (req, res) => {
    try { const c = await db.getCustomer(req.params.id); if (!c) return res.status(404).json({ error: 'Not found' }); res.json(c); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/customers', requireAuth, async (req, res) => {
    const { name, phone, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try { const id = await db.addCustomer(name, phone, address, notes); res.json({ success: true, id }); }
    catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Customer name already exists' }); res.status(500).json({ error: err.message }); }
});
app.put('/api/customers/:id', requireAuth, async (req, res) => {
    const { name, phone, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try { await db.updateCustomer(req.params.id, name, phone, address, notes); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/customers/:id', requireAuth, async (req, res) => {
    try { await db.deleteCustomer(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/customers/:name/orders', requireAuth, async (req, res) => {
    try { res.json(await db.getCustomerOrders(req.params.name)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// REPORTS
app.get('/api/reports', requireAuth, async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo are required' });
        const [summary, daily, topServices, topCustomers] = await Promise.all([
            db.getReportSummary(dateFrom, dateTo),
            db.getReportDaily(dateFrom, dateTo),
            db.getReportTopServices(dateFrom, dateTo),
            db.getReportTopCustomers(dateFrom, dateTo)
        ]);
        res.json({ summary, daily, topServices, topCustomers });
    } catch (err) { console.error('Reports error:', err); res.status(500).json({ error: err.message }); }
});

// DASHBOARD
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = await db.pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE date LIKE $1", [today + '%']);
        const allTime = await db.pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders");
        const pending = await db.pool.query("SELECT COUNT(*) AS count FROM orders WHERE payment_status = 'Pending'");
        const topServices = await db.pool.query("SELECT service_name, SUM(quantity) AS total_qty, SUM(quantity * price) AS total_revenue FROM order_items GROUP BY service_name ORDER BY total_qty DESC LIMIT 5");
        const recentOrders = await db.pool.query("SELECT id, date, customer, total, payment_status FROM orders ORDER BY id DESC LIMIT 10");
        const weekly = await db.pool.query("SELECT DATE(date::timestamptz) AS day, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE date::timestamptz >= NOW() - INTERVAL '7 days' GROUP BY DATE(date::timestamptz) ORDER BY day ASC");
        res.json({
            today: { orders: parseInt(todayOrders.rows[0].count), revenue: parseFloat(todayOrders.rows[0].revenue) },
            allTime: { orders: parseInt(allTime.rows[0].count), revenue: parseFloat(allTime.rows[0].revenue) },
            pending: parseInt(pending.rows[0].count),
            topServices: topServices.rows, recentOrders: recentOrders.rows, weekly: weekly.rows
        });
    } catch (err) { console.error('Dashboard error:', err); res.status(500).json({ error: err.message }); }
});

// SETTINGS
app.get('/api/settings', requireAuth, async (req, res) => {
    try { res.json(await db.getAllSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/settings/public', async (req, res) => {
    try { res.json(await db.getAllSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/settings', requireAuth, async (req, res) => {
    try { await db.updateSettings(req.body); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// CASHIERS
app.get('/api/cashiers', requireAuth, async (req, res) => {
    try { res.json(await db.getCashiers()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/cashiers', requireAuth, async (req, res) => {
    const { name, pin } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name and PIN are required' });
    if (pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    try { const id = await db.addCashier(name, pin); res.json({ success: true, id }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/cashiers/:id/pin', requireAuth, async (req, res) => {
    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    try { await db.updateCashierPin(req.params.id, pin); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/cashiers/:id', requireAuth, async (req, res) => {
    try { await db.deleteCashier(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/cashiers/verify', async (req, res) => {
    const { pin } = req.body;
    try {
        const cashier = await db.findCashierByPin(pin);
        if (cashier) res.json({ success: true, cashier });
        else res.status(401).json({ success: false, error: 'Invalid PIN' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PRODUCTS
app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const { search = '', category = '' } = req.query;
        res.json(await db.getProducts(search, category));
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/products/categories', requireAuth, async (req, res) => {
    try { res.json(await db.getProductCategories()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/products/low-stock', requireAuth, async (req, res) => {
    try { res.json(await db.getLowStockProducts()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/products', requireAuth, async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Name is required' });
    try { const id = await db.addProduct(req.body); res.json({ success: true, id }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/products/:id', requireAuth, async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: 'Name is required' });
    try { await db.updateProduct(req.params.id, req.body); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/products/:id', requireAuth, async (req, res) => {
    try { await db.deleteProduct(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/products/:id/replenish', requireAuth, async (req, res) => {
    const { quantity, cost, notes } = req.body;
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    try { await db.replenishProduct(req.params.id, parseInt(quantity), parseFloat(cost) || 0, notes); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/replenishments', requireAuth, async (req, res) => {
    try { res.json(await db.getReplenishments()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));