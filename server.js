const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/api/services', async (req, res) => {
    try {
        const services = await db.getServices();
        res.json(services);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/services', async (req, res) => {
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

app.delete('/api/services/:id', async (req, res) => {
    try {
        await db.deleteService(req.params.id);
        res.json({ message: "Service deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/checkout', async (req, res) => {
    const { customer, total, cartItems } = req.body;
    try {
        const orderId = await db.saveOrder(customer, total, cartItems);
        res.json({ message: "Order saved successfully!", orderId: orderId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});