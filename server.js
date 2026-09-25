const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = 'shop1234';
const sessions = new Map();

function buildServiceFlow(cartItems, hasPickupDelivery) {
    const names = cartItems.filter(i => !i.isPickupFee).map(i => (i.name || '').toLowerCase());
    const hasWash = names.some(n => n.includes('wash'));
    const hasDry = names.some(n => n.includes('dry'));
    const hasFold = names.some(n => n.includes('fold'));

    const flow = ['Received'];

    if (hasDry && !hasWash && !hasFold) {
        flow.push('Spin & Dry');
    } else {
        if (hasWash) flow.push('Washing');
        if (hasDry) flow.push('Drying');
        if (hasFold) flow.push('Folding');
    }

    flow.push('Done (Ready to Pickup)');

    if (hasPickupDelivery) {
        flow.push('Out for Delivery');
        flow.push('Delivered');
    }

    return flow;
}

const mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

async function sendEmail(to, subject, htmlBody) {
    try {
        await mailer.sendMail({ from: `"Hawi's Lovada" <${process.env.GMAIL_USER}>`, to, subject, html: htmlBody });
        return true;
    } catch (err) { console.error('Email error:', err.message); return false; }
}

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
        res.json({ success: true, token });
    } else res.status(401).json({ success: false, error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) sessions.delete(token);
    res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    try {
        const user = await db.getUserByUsername(username);
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
        const token = Date.now() + '-' + crypto.randomBytes(16).toString('hex');
        sessions.set(token, { userId: user.id, username: user.username, role: user.role, createdAt: Date.now() });
        await db.updateLastLogin(user.id);
        res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, password, email, full_name, security_question, security_answer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const count = await db.getUserCount();
        if (count > 0) return res.status(403).json({ error: 'Signup is closed. Please ask the owner to add you.' });
        const existing = await db.getUserByUsername(username);
        if (existing) return res.status(400).json({ error: 'Username already exists' });
        const password_hash = await bcrypt.hash(password, 10);
        const security_answer_hash = security_answer ? await bcrypt.hash(security_answer.toLowerCase().trim(), 10) : null;
        const id = await db.createUser({ username, password_hash, email, full_name, role: 'owner', security_question, security_answer_hash });
        res.json({ success: true, id, message: 'Owner account created. You can now log in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/signup-status', async (req, res) => {
    try { const count = await db.getUserCount(); res.json({ open: count === 0 }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/forgot', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
        const user = await db.getUserByEmail(email);
        if (!user) return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await db.setResetToken(user.id, token, expires);
        const baseUrl = req.protocol + '://' + req.get('host');
        const resetLink = `${baseUrl}/reset.html?token=${token}`;
        const html = `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px;"><h2 style="color: #1e40af;">Hawi's Lovada — Password Reset</h2><p>Hi ${user.full_name || user.username},</p><p>Click below to set a new password. Expires in 1 hour.</p><p style="text-align: center; margin: 30px 0;"><a href="${resetLink}" style="background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset My Password</a></p><p style="font-size: 12px; color: #666;">Or copy: <br>${resetLink}</p><hr><p style="font-size: 12px; color: #999;">If you didn't request this, ignore this email.</p></div>`;
        const sent = await sendEmail(user.email, "Hawi's Lovada — Password Reset", html);
        if (!sent) return res.status(500).json({ error: 'Failed to send email. Please try again later.' });
        res.json({ success: true, message: 'Reset link sent. Check your email.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const user = await db.getUserByResetToken(token);
        if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
        const password_hash = await bcrypt.hash(password, 10);
        await db.updateUserPassword(user.id, password_hash);
        await db.clearResetToken(user.id);
        res.json({ success: true, message: 'Password updated. You can now log in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/recover-by-question', async (req, res) => {
    const { username, security_answer, new_password } = req.body;
    if (!username || !security_answer || !new_password) return res.status(400).json({ error: 'All fields required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const user = await db.getUserByUsername(username);
        if (!user || !user.security_answer_hash) return res.status(400).json({ error: 'Recovery not available for this account' });
        const ok = await bcrypt.compare(security_answer.toLowerCase().trim(), user.security_answer_hash);
        if (!ok) return res.status(401).json({ error: 'Wrong security answer' });
        const password_hash = await bcrypt.hash(new_password, 10);
        await db.updateUserPassword(user.id, password_hash);
        res.json({ success: true, message: 'Password updated. You can now log in.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/me', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ error: 'Session expired' });
        const user = await db.getUserById(session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        delete user.password_hash; delete user.security_answer_hash;
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/me', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ error: 'Session expired' });
        const { full_name, email } = req.body;
        await db.pool.query("UPDATE users SET full_name = $1, email = $2 WHERE id = $3", [full_name || null, email || null, session.userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/me/password', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ error: 'Session expired' });
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new password required' });
        if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
        const user = await db.getUserById(session.userId);
        const ok = await bcrypt.compare(current_password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
        const hash = await bcrypt.hash(new_password, 10);
        await db.updateUserPassword(session.userId, hash);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/me/security', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ error: 'Session expired' });
        const { current_password, security_question, security_answer } = req.body;
        if (!current_password || !security_question || !security_answer) return res.status(400).json({ error: 'All fields required' });
        const user = await db.getUserById(session.userId);
        const ok = await bcrypt.compare(current_password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
        const ans_hash = await bcrypt.hash(security_answer.toLowerCase().trim(), 10);
        await db.pool.query("UPDATE users SET security_question = $1, security_answer_hash = $2 WHERE id = $3",
            [security_question, ans_hash, session.userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', requireAuth, async (req, res) => {
    try { res.json(await db.getAllUsers()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users', requireAuth, async (req, res) => {
    const { username, password, email, full_name, role, security_question, security_answer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!['owner', 'admin', 'cashier'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        const creator = await db.getUserById(session.userId);
        if (role === 'owner') return res.status(403).json({ error: 'Cannot create another owner' });
        if (role === 'admin' && creator.role !== 'owner') return res.status(403).json({ error: 'Only owner can create admins' });
        const existing = await db.getUserByUsername(username);
        if (existing) return res.status(400).json({ error: 'Username already exists' });
        const password_hash = await bcrypt.hash(password, 10);
        const security_answer_hash = security_answer ? await bcrypt.hash(security_answer.toLowerCase().trim(), 10) : null;
        const id = await db.createUser({ username, password_hash, email, full_name, role, security_question, security_answer_hash });
        res.json({ success: true, id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id/role', requireAuth, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'cashier'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        const updater = await db.getUserById(session.userId);
        if (updater.role !== 'owner') return res.status(403).json({ error: 'Only owner can change roles' });
        await db.updateUserRole(req.params.id, role);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id/password', requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    try {
        const password_hash = await bcrypt.hash(password, 10);
        await db.updateUserPassword(req.params.id, password_hash);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
    try {
        const count = await db.getUserCount();
        if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last user' });
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        const target = await db.getUserById(req.params.id);
        if (target && target.role === 'owner') return res.status(403).json({ error: 'Cannot delete the owner' });
        if (target && session.userId === target.id) return res.status(400).json({ error: 'Cannot delete yourself' });
        await db.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== SERVICES =====
app.get('/api/services', requireAuth, async (req, res) => {
    try { res.json(await db.getServices()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pickup-service', requireAuth, async (req, res) => {
    try {
        const service = await db.getPickupService();
        if (!service) return res.status(404).json({ error: 'No pickup/delivery service configured.' });
        res.json({ id: service.id, name: service.name, price: parseFloat(service.price), unit: service.unit_label || service.unit || 'kg' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/services', requireAuth, async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: "Service name is required" });
    try { const id = await db.addService(req.body); res.json({ message: "Service added", id }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/services/:id', requireAuth, async (req, res) => {
    if (!req.body.name) return res.status(400).json({ error: "Service name is required" });
    try { await db.updateService(req.params.id, req.body); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/services/:id', requireAuth, async (req, res) => {
    try { await db.deleteService(req.params.id); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CHECKOUT =====
app.post('/api/checkout', requireAuth, async (req, res) => {
    const { customer, total, cartItems, paymentStatus, cashierName, pickupDelivery, customerPhone } = req.body;
    try {
        if (!cartItems || cartItems.length === 0) return res.status(400).json({ error: 'Cart is empty' });
        if (pickupDelivery) {
            if (!customer || customer.trim() === '' || customer === 'Walk-In Customer') {
                return res.status(400).json({ error: 'Customer name is required for Pickup & Delivery' });
            }
            if (!customerPhone || !/^09\d{9}$/.test(customerPhone)) {
                return res.status(400).json({ error: 'Cellphone number required (11 digits, starts with 09)' });
            }
        }
        const serviceFlow = buildServiceFlow(cartItems, pickupDelivery);
        const orderId = await db.saveOrder(customer, total, cartItems, paymentStatus, cashierName, pickupDelivery, customerPhone, serviceFlow);
        res.json({ message: "Order saved successfully!", orderId, serviceFlow });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ORDERS =====
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
    const validStatuses = ['Received', 'Washing', 'Drying', 'Folding', 'Spin & Dry', 'Done (Ready to Pickup)', 'Out for Delivery', 'Delivered', 'Ready', 'Picked Up'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try { await db.updateOrderStatus(req.params.id, status); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/orders/:id', requireAuth, async (req, res) => {
    try { await db.deleteOrder(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/:id/next-status', requireAuth, async (req, res) => {
    try {
        const { riderName } = req.body;
        const order = await db.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        const flow = order.service_flow || ['Received'];
        const nextStep = (order.current_step || 0) + 1;
        if (nextStep >= flow.length) return res.status(400).json({ error: 'Order is already at final status' });
        const newStatus = flow[nextStep];
        const history = [...(order.status_history || []), { status: newStatus, at: new Date().toISOString() }];
        await db.updateOrderStatus(req.params.id, newStatus, nextStep, JSON.stringify(history), newStatus === 'Out for Delivery' ? (riderName || null) : null);
        res.json({ success: true, newStatus, currentStep: nextStep, serviceFlow: flow });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/track/:orderId', async (req, res) => {
    try {
        const order = await db.getOrderById(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found. Please check your receipt number.' });
        const itemsResult = await db.pool.query("SELECT service_name, quantity, price FROM order_items WHERE order_id = $1", [req.params.orderId]);
        res.json({
            orderId: order.id, customer: order.customer, total: parseFloat(order.total),
            status: order.status, serviceFlow: order.service_flow || [], currentStep: order.current_step || 0,
            statusHistory: order.status_history || [], pickupDelivery: order.pickup_delivery,
            customerPhone: order.customer_phone, riderName: order.rider_name,
            createdAt: order.date, paymentStatus: order.payment_status, items: itemsResult.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/batch/status', requireAuth, async (req, res) => {
    const { ids, status } = req.body;
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
// ===== ARCHIVE =====
app.get('/api/orders/archive', requireAuth, async (req, res) => {
    try {
        const { search = '' } = req.query;
        const orders = await db.getArchivedOrders('all', search);
        res.json(orders);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/:id/archive', requireAuth, async (req, res) => {
    try {
        await db.archiveOrder(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/:id/restore', requireAuth, async (req, res) => {
    try {
        await db.restoreOrder(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/batch/archive', requireAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No orders selected' });
    try {
        const count = await db.archiveBatch(ids);
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/orders/archive/cleanup', requireAuth, async (req, res) => {
    try {
        const deleted = await db.cleanupOldArchive();
        res.json({ success: true, deleted });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CUSTOMERS =====
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

// ===== REPORTS =====
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== DASHBOARD =====
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = await db.pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE date LIKE $1", [today + '%']);
        const allTime = await db.pool.query("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue FROM orders");
        const pending = await db.pool.query("SELECT COUNT(*) AS count FROM orders WHERE payment_status = 'Pending'");
        const topServices = await db.pool.query("SELECT service_name, SUM(quantity) AS total_qty, SUM(quantity * price) AS total_revenue FROM order_items GROUP BY service_name ORDER BY total_qty DESC LIMIT 5");
        const recentOrders = await db.pool.query("SELECT id, date, customer, total, payment_status FROM orders ORDER BY id DESC LIMIT 10");
        res.json({
            today: { orders: parseInt(todayOrders.rows[0].count), revenue: parseFloat(todayOrders.rows[0].revenue) },
            allTime: { orders: parseInt(allTime.rows[0].count), revenue: parseFloat(allTime.rows[0].revenue) },
            pending: parseInt(pending.rows[0].count),
            topServices: topServices.rows, recentOrders: recentOrders.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dashboard/years', requireAuth, async (req, res) => {
    try {
        const result = await db.pool.query("SELECT DISTINCT EXTRACT(YEAR FROM date::timestamptz) AS y FROM orders ORDER BY y ASC");
        const years = result.rows.map(r => parseInt(r.y));
        const currentYear = new Date().getFullYear();
        if (!years.includes(currentYear)) years.push(currentYear);
        years.sort((a, b) => a - b);
        res.json(years);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dashboard/chart', requireAuth, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = req.query.month || 'all';
        const view = req.query.view || 'month';
        let query, params;
        if (view === 'month' || month === 'all') {
            query = `SELECT DATE_TRUNC('month', date::timestamptz) AS day, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE EXTRACT(YEAR FROM date::timestamptz) = $1 GROUP BY DATE_TRUNC('month', date::timestamptz) ORDER BY day ASC`;
            params = [year];
        } else {
            query = `SELECT DATE(date::timestamptz) AS day, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE EXTRACT(YEAR FROM date::timestamptz) = $1 AND EXTRACT(MONTH FROM date::timestamptz) = $2 GROUP BY DATE(date::timestamptz) ORDER BY day ASC`;
            params = [year, parseInt(month)];
        }
        const result = await db.pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== SETTINGS =====
app.get('/api/settings', requireAuth, async (req, res) => {
    try { res.json(await db.getAllSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/settings/public', async (req, res) => {
    try { res.json(await db.getAllSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/settings', requireAuth, async (req, res) => {
    try { await db.updateSettings(req.body); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CASHIERS =====
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
        if (cashier) res.json({ success: true, cashier }); else res.status(401).json({ success: false, error: 'Invalid PIN' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/cashiers/admin-verify', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
    try {
        const user = await db.getUserByUsername(username);
        if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password' });
        if (user.role !== 'owner' && user.role !== 'admin') return res.status(403).json({ success: false, error: 'Only owner or admin can use this option' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ success: false, error: 'Invalid username or password' });
        res.json({ success: true, cashier: { id: user.id, name: user.full_name || user.username } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== PRODUCTS =====
app.get('/api/products', requireAuth, async (req, res) => {
    try { const { search = '', category = '' } = req.query; res.json(await db.getProducts(search, category)); }
    catch (err) { res.status(500).json({ error: err.message }); }
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
    const { quantity, cost, notes, supplier } = req.body;
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    try { await db.replenishProduct(req.params.id, parseInt(quantity), parseFloat(cost) || 0, notes, supplier); res.json({ success: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/replenishments', requireAuth, async (req, res) => {
    try { res.json(await db.getReplenishments()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== EXPENSES =====
app.get('/api/expenses', requireAuth, async (req, res) => {
    try {
        const { search = '', category = '', dateFrom = '', dateTo = '' } = req.query;
        res.json(await db.getExpenses(search, category, dateFrom, dateTo));
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/expenses/ledger', requireAuth, async (req, res) => {
    try { const { search = '', dateFrom = '', dateTo = '' } = req.query; res.json(await db.getUnifiedLedger(dateFrom, dateTo, search)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/expenses/stats', requireAuth, async (req, res) => {
    try { const { dateFrom = '', dateTo = '' } = req.query; res.json(await db.getLedgerStats(dateFrom, dateTo)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/expenses/categories', requireAuth, async (req, res) => {
    try { res.json(await db.getExpenseCategories()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/expenses', requireAuth, async (req, res) => {
    if (!req.body.amount || parseFloat(req.body.amount) <= 0) return res.status(400).json({ error: 'Amount is required' });
    if (!req.body.category) return res.status(400).json({ error: 'Category is required' });
    try { const id = await db.addExpense(req.body); res.json({ success: true, id }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/expenses/:id', requireAuth, async (req, res) => {
    try { await db.updateExpense(req.params.id, req.body); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
    try { await db.deleteExpense(req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/me/verify-answer', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ success: false, error: 'Session expired' });
        const { answer } = req.body;
        if (!answer) return res.status(400).json({ success: false, error: 'Answer required' });
        const user = await db.getUserById(session.userId);
        if (!user || !user.security_answer_hash) return res.status(400).json({ success: false, error: 'No security question set' });
        const ok = await bcrypt.compare(answer.toLowerCase().trim(), user.security_answer_hash);
        if (!ok) return res.status(401).json({ success: false, error: 'Wrong answer' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/users/me/change-password-verified', requireAuth, async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        const session = sessions.get(token);
        if (!session || !session.userId) return res.status(401).json({ success: false, error: 'Session expired' });
        const { answer, new_password, update_security, security_question, security_answer } = req.body;
        if (!answer || !new_password) return res.status(400).json({ success: false, error: 'Answer and new password required' });
        if (new_password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        const user = await db.getUserById(session.userId);
        if (!user || !user.security_answer_hash) return res.status(400).json({ success: false, error: 'No security question set' });
        const ok = await bcrypt.compare(answer.toLowerCase().trim(), user.security_answer_hash);
        if (!ok) return res.status(401).json({ success: false, error: 'Wrong answer' });
        const hash = await bcrypt.hash(new_password, 10);
        await db.updateUserPassword(session.userId, hash);
        if (update_security && security_question && security_answer) {
            const ans_hash = await bcrypt.hash(security_answer.toLowerCase().trim(), 10);
            await db.pool.query("UPDATE users SET security_question = $1, security_answer_hash = $2 WHERE id = $3",
                [security_question, ans_hash, session.userId]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));