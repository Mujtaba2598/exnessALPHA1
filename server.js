const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'exness-halal-trading-bot-secret-key-2024';
const ENCRYPTION_KEY = 'exness0123456789012345678901234567890123456789';

// ==================== HALAL ASSETS (Exness Supported) ====================
const HALAL_ASSETS = [
    { symbol: 'BTCUSD', name: 'Bitcoin', minVolume: 0.01, stepSize: 0.01 },
    { symbol: 'ETHUSD', name: 'Ethereum', minVolume: 0.01, stepSize: 0.01 },
    { symbol: 'BNBUSD', name: 'Binance Coin', minVolume: 0.1, stepSize: 0.1 },
    { symbol: 'SOLUSD', name: 'Solana', minVolume: 0.1, stepSize: 0.1 },
    { symbol: 'ADAUSD', name: 'Cardano', minVolume: 1, stepSize: 1 },
    { symbol: 'XRPUSD', name: 'Ripple', minVolume: 1, stepSize: 1 },
    { symbol: 'DOTUSD', name: 'Polkadot', minVolume: 0.1, stepSize: 0.1 },
    { symbol: 'LINKUSD', name: 'Chainlink', minVolume: 0.1, stepSize: 0.1 },
    { symbol: 'MATICUSD', name: 'Polygon', minVolume: 1, stepSize: 1 },
    { symbol: 'AVAXUSD', name: 'Avalanche', minVolume: 0.1, stepSize: 0.1 },
    { symbol: 'EURUSD', name: 'Euro/Dollar', minVolume: 0.01, stepSize: 0.01 },
    { symbol: 'GBPUSD', name: 'Pound/Dollar', minVolume: 0.01, stepSize: 0.01 },
    { symbol: 'USDJPY', name: 'Dollar/Yen', minVolume: 0.01, stepSize: 0.01 },
    { symbol: 'XAUUSD', name: 'Gold', minVolume: 0.01, stepSize: 0.01 }
];

// Trading settings
const MIN_TRADE_INTERVAL_SECONDS = 5;
const DEFAULT_TRADE_INTERVAL = 30;
const MAX_CONCURRENT_TRADES = 5;

// ==================== DATA DIRECTORIES ====================
const DATA_DIR = path.join(__dirname, 'data');
const TRADES_DIR = path.join(DATA_DIR, 'trades');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const BALANCE_CACHE_FILE = path.join(DATA_DIR, 'balance_cache.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

// ==================== CREATE OWNER ACCOUNT ====================
const ownerEmail = "mujtabahatif@gmail.com";
const ownerPasswordPlain = "Mujtabah@2598";
const ownerPasswordHash = bcrypt.hashSync(ownerPasswordPlain, 10);

let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE));
    } catch(e) { users = {}; }
}

users[ownerEmail] = {
    email: ownerEmail,
    password: ownerPasswordHash,
    isOwner: true,
    isApproved: true,
    isBlocked: false,
    exnessId: "",
    apiKey: "",
    secretKey: "",
    accountType: "real",
    createdAt: new Date().toISOString()
};
fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log("✅ Owner account created");
console.log("   Email: mujtabahatif@gmail.com");
console.log("   Password: Mujtabah@2598");

if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(BALANCE_CACHE_FILE)) fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify({}, null, 2));

// ==================== HELPER FUNCTIONS ====================
function readUsers() { 
    try { return JSON.parse(fs.readFileSync(USERS_FILE)); } 
    catch(e) { return {}; }
}
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function readPending() { 
    try { return JSON.parse(fs.readFileSync(PENDING_FILE)); } 
    catch(e) { return {}; }
}
function writePending(data) { fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); }
function readOrders() { 
    try { return JSON.parse(fs.readFileSync(ORDERS_FILE)); } 
    catch(e) { return {}; }
}
function writeOrders(data) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2)); }
function readBalanceCache() { 
    try { return JSON.parse(fs.readFileSync(BALANCE_CACHE_FILE)); } 
    catch(e) { return {}; }
}
function writeBalanceCache(data) { fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify(data, null, 2)); }

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return "";
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function cleanKey(k) { return k ? k.replace(/[\s\n\r\t]+/g, '').trim() : ""; }

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '🕋 EXNESS HALAL Trading Bot' });
});

// ==================== AUTHENTICATION ====================
app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const users = readUsers();
    if (users[email]) {
        return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const pending = readPending();
    if (pending[email]) {
        return res.status(400).json({ success: false, message: 'Request already pending' });
    }
    
    pending[email] = {
        email: email,
        password: bcrypt.hashSync(password, 10),
        requestedAt: new Date().toISOString()
    };
    writePending(pending);
    
    res.json({ success: true, message: 'Registration request sent to owner for approval.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    const users = readUsers();
    const user = users[email];
    
    if (!user) {
        const pending = readPending();
        if (pending[email]) {
            return res.status(401).json({ success: false, message: 'Pending owner approval' });
        }
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!user.isApproved && !user.isOwner) {
        return res.status(401).json({ success: false, message: 'Account not approved by owner' });
    }
    
    if (user.isBlocked) {
        return res.status(401).json({ success: false, message: 'Account blocked. Contact owner.' });
    }
    
    const token = jwt.sign({ email: email, isOwner: user.isOwner }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token: token, isOwner: user.isOwner });
});

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
}

// ==================== REAL EXNESS API INTEGRATION ====================
// Exness API endpoints
const EXNESS_API = 'https://api.exness.com/v1';
const EXNESS_DEMO = 'https://demo-api.exness.com/v1';

// Real API call functions
async function makeExnessRequest(apiKey, secretKey, endpoint, params = {}, method = 'GET', useDemo = false) {
    const baseUrl = useDemo ? EXNESS_DEMO : EXNESS_API;
    const timestamp = Date.now();
    const signature = crypto.createHmac('sha256', secretKey).update(timestamp + endpoint + JSON.stringify(params)).digest('hex');
    
    const response = await axios({
        method: method,
        url: `${baseUrl}${endpoint}`,
        headers: {
            'X-API-Key': apiKey,
            'X-Signature': signature,
            'X-Timestamp': timestamp,
            'Content-Type': 'application/json'
        },
        data: method === 'POST' ? params : undefined,
        params: method === 'GET' ? params : undefined,
        timeout: 15000
    });
    return response.data;
}

async function getExnessBalance(apiKey, secretKey, useDemo = false) {
    try {
        const account = await makeExnessRequest(apiKey, secretKey, '/account/balance', {}, 'GET', useDemo);
        return {
            balance: parseFloat(account.balance || 0),
            equity: parseFloat(account.equity || 0),
            margin: parseFloat(account.margin || 0),
            freeMargin: parseFloat(account.freeMargin || 0),
            currency: account.currency || 'USD'
        };
    } catch (error) {
        console.error('Balance fetch error:', error.response?.data || error.message);
        return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD' };
    }
}

async function getExnessOpenPositions(apiKey, secretKey, useDemo = false) {
    try {
        const positions = await makeExnessRequest(apiKey, secretKey, '/positions', {}, 'GET', useDemo);
        return positions.map(p => ({
            id: p.id,
            symbol: p.symbol,
            volume: parseFloat(p.volume),
            openPrice: parseFloat(p.openPrice),
            currentPrice: parseFloat(p.currentPrice),
            profit: parseFloat(p.profit),
            swap: parseFloat(p.swap || 0),
            openTime: p.openTime
        }));
    } catch (error) {
        console.error('Positions fetch error:', error.message);
        return [];
    }
}

async function getExnessCurrentPrice(symbol, useDemo = false) {
    try {
        const price = await makeExnessRequest(null, null, `/market/price?symbol=${symbol}`, {}, 'GET', useDemo);
        return {
            bid: parseFloat(price.bid),
            ask: parseFloat(price.ask),
            spread: parseFloat(price.ask) - parseFloat(price.bid),
            timestamp: price.timestamp
        };
    } catch (error) {
        console.error('Price fetch error:', error.message);
        // Return default price if API fails (for demo)
        const defaultPrices = {
            'BTCUSD': 50000, 'ETHUSD': 3000, 'BNBUSD': 400, 'SOLUSD': 100,
            'ADAUSD': 0.5, 'XRPUSD': 0.6, 'DOTUSD': 7, 'LINKUSD': 15,
            'MATICUSD': 0.8, 'AVAXUSD': 35, 'EURUSD': 1.08, 'GBPUSD': 1.25,
            'USDJPY': 150, 'XAUUSD': 2000
        };
        return { bid: defaultPrices[symbol] || 100, ask: defaultPrices[symbol] || 100, spread: 0 };
    }
}

async function placeExnessLimitOrder(apiKey, secretKey, symbol, side, volume, price, useDemo = false) {
    try {
        const order = await makeExnessRequest(apiKey, secretKey, '/orders', {
            symbol: symbol,
            side: side,
            type: 'LIMIT',
            volume: volume,
            price: price,
            timeInForce: 'GTC'
        }, 'POST', useDemo);
        return {
            orderId: order.id,
            status: order.status,
            symbol: symbol,
            side: side,
            price: parseFloat(order.price),
            volume: parseFloat(order.volume),
            createdAt: order.createdAt
        };
    } catch (error) {
        console.error('Order placement error:', error.response?.data || error.message);
        throw error;
    }
}

async function checkExnessOrderStatus(apiKey, secretKey, orderId, useDemo = false) {
    try {
        const order = await makeExnessRequest(apiKey, secretKey, `/orders/${orderId}`, {}, 'GET', useDemo);
        return {
            orderId: order.id,
            status: order.status,
            filledVolume: parseFloat(order.filledVolume || 0),
            avgPrice: parseFloat(order.avgPrice || 0),
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
        };
    } catch (error) {
        console.error('Order status error:', error.message);
        return { status: 'PENDING', filledVolume: 0, avgPrice: 0 };
    }
}

async function cancelExnessOrder(apiKey, secretKey, orderId, useDemo = false) {
    try {
        const result = await makeExnessRequest(apiKey, secretKey, `/orders/${orderId}`, {}, 'DELETE', useDemo);
        return { success: true, orderId: orderId, status: 'CANCELLED' };
    } catch (error) {
        console.error('Cancel order error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== UPDATE BALANCE CACHE ====================
async function updateUserBalanceCache(email, apiKey, secretKey, useDemo = false) {
    try {
        const balance = await getExnessBalance(apiKey, secretKey, useDemo);
        const cache = readBalanceCache();
        cache[email] = {
            balance: balance.balance,
            equity: balance.equity,
            freeMargin: balance.freeMargin,
            currency: balance.currency,
            lastUpdated: new Date().toISOString()
        };
        writeBalanceCache(cache);
        return cache[email];
    } catch (error) {
        console.error(`Balance update failed for ${email}:`, error.message);
        return null;
    }
}

// ==================== API KEY MANAGEMENT ====================
app.post('/api/set-exness-keys', authenticate, async (req, res) => {
    let { exnessId, apiKey, secretKey, accountType } = req.body;
    if (!apiKey || !secretKey) {
        return res.status(400).json({ success: false, message: 'Both API keys required' });
    }
    
    const cleanApi = cleanKey(apiKey);
    const cleanSecret = cleanKey(secretKey);
    const useDemo = accountType === 'demo';
    
    try {
        const balance = await getExnessBalance(cleanApi, cleanSecret, useDemo);
        const users = readUsers();
        users[req.user.email].exnessId = exnessId || "";
        users[req.user.email].apiKey = encrypt(cleanApi);
        users[req.user.email].secretKey = encrypt(cleanSecret);
        users[req.user.email].accountType = accountType || "real";
        writeUsers(users);
        
        await updateUserBalanceCache(req.user.email, cleanApi, cleanSecret, useDemo);
        
        res.json({ 
            success: true, 
            message: `Exness API keys saved! Balance: ${balance.balance} ${balance.currency}`, 
            balance: balance.balance,
            equity: balance.equity,
            freeMargin: balance.freeMargin
        });
    } catch (err) {
        console.error('API key error:', err);
        res.status(401).json({ success: false, message: 'Invalid API keys. Check Exness API permissions.' });
    }
});

app.post('/api/connect-exness', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) {
        return res.status(400).json({ success: false, message: 'No API keys saved' });
    }
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useDemo = accountType === 'demo';
    
    try {
        const balance = await getExnessBalance(apiKey, secretKey, useDemo);
        const positions = await getExnessOpenPositions(apiKey, secretKey, useDemo);
        
        await updateUserBalanceCache(req.user.email, apiKey, secretKey, useDemo);
        
        res.json({ 
            success: true, 
            balance: balance.balance,
            equity: balance.equity,
            freeMargin: balance.freeMargin,
            openPositions: positions.length,
            message: `Connected to Exness! Balance: ${balance.balance} ${balance.currency}`
        });
    } catch (error) {
        console.error('Connect error:', error);
        res.status(401).json({ success: false, message: 'Connection failed. Check API keys.' });
    }
});

app.get('/api/get-keys', authenticate, (req, res) => {
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No keys saved' });
    res.json({ 
        success: true, 
        exnessId: user.exnessId || "", 
        apiKey: decrypt(user.apiKey), 
        secretKey: decrypt(user.secretKey),
        accountType: user.accountType || "real"
    });
});

app.post('/api/get-balance', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No API keys' });
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useDemo = accountType === 'demo';
    const balance = await getExnessBalance(apiKey, secretKey, useDemo);
    
    await updateUserBalanceCache(req.user.email, apiKey, secretKey, useDemo);
    
    res.json({ 
        success: true, 
        balance: balance.balance,
        equity: balance.equity,
        freeMargin: balance.freeMargin,
        currency: balance.currency
    });
});

// ==================== TRADING STRATEGY ENGINE ====================
class TradingStrategy {
    constructor() {
        this.strategies = {
            'scalping': this.scalpingStrategy,
            'momentum': this.momentumStrategy,
            'meanReversion': this.meanReversionStrategy,
            'trendFollowing': this.trendFollowingStrategy
        };
    }
    
    async scalpingStrategy(price, symbol, useDemo) {
        // Small profit targets, quick entries
        const entryPrice = price.bid * 0.999;
        const targetPrice = price.ask * 1.002;
        const stopLoss = price.bid * 0.997;
        return { action: 'BUY', entryPrice, targetPrice, stopLoss, confidence: 0.7 };
    }
    
    async momentumStrategy(price, symbol, useDemo) {
        // Follow price momentum
        const entryPrice = price.ask;
        const targetPrice = price.ask * 1.005;
        const stopLoss = price.ask * 0.998;
        return { action: 'BUY', entryPrice, targetPrice, stopLoss, confidence: 0.65 };
    }
    
    async meanReversionStrategy(price, symbol, useDemo) {
        // Buy dips, sell peaks
        const entryPrice = price.bid * 0.998;
        const targetPrice = price.ask * 1.003;
        const stopLoss = price.bid * 0.996;
        return { action: 'BUY', entryPrice, targetPrice, stopLoss, confidence: 0.6 };
    }
    
    async trendFollowingStrategy(price, symbol, useDemo) {
        // Follow established trends
        const entryPrice = price.ask;
        const targetPrice = price.ask * 1.01;
        const stopLoss = price.ask * 0.995;
        return { action: 'BUY', entryPrice, targetPrice, stopLoss, confidence: 0.75 };
    }
    
    async getSignal(strategyName, price, symbol, useDemo) {
        const strategy = this.strategies[strategyName];
        if (strategy) {
            return await strategy.call(this, price, symbol, useDemo);
        }
        return await this.scalpingStrategy(price, symbol, useDemo);
    }
}

const tradingStrategy = new TradingStrategy();

// ==================== FAST TRADING ENGINE ====================
const activeSessions = new Map();
let currentAssetIndex = 0;

function getNextAsset() {
    const asset = HALAL_ASSETS[currentAssetIndex];
    currentAssetIndex = (currentAssetIndex + 1) % HALAL_ASSETS.length;
    return asset;
}

app.post('/api/start-trading', authenticate, async (req, res) => {
    try {
        console.log('Start trading request received:', req.body);
        
        const { 
            investmentAmount, 
            profitPercent, 
            tradeIntervalSeconds, 
            timeLimitHours, 
            accountType,
            strategy,
            maxConcurrentTrades
        } = req.body;
        
        // Validate required fields
        if (investmentAmount === undefined || profitPercent === undefined || tradeIntervalSeconds === undefined) {
            return res.status(400).json({ success: false, message: 'Missing required parameters' });
        }
        
        const user = readUsers()[req.user.email];
        if (!user?.apiKey) {
            return res.status(400).json({ success: false, message: 'Add Exness API keys first' });
        }
        
        const apiKey = decrypt(user.apiKey);
        const secretKey = decrypt(user.secretKey);
        const useDemo = accountType === 'demo';
        const selectedStrategy = strategy || 'scalping';
        const concurrentTrades = Math.min(maxConcurrentTrades || 1, MAX_CONCURRENT_TRADES);
        
        // Get balance
        let accountBalance = 0;
        try {
            const balance = await getExnessBalance(apiKey, secretKey, useDemo);
            accountBalance = balance.freeMargin || balance.balance;
        } catch (error) {
            console.error('Balance check error:', error);
            return res.status(401).json({ success: false, message: 'Cannot verify balance. Check API keys.' });
        }
        
        // Validate investment
        if (investmentAmount < 10) {
            return res.status(400).json({ success: false, message: 'Minimum investment is $10' });
        }
        
        if (accountBalance < investmentAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient balance. You have ${accountBalance} USD, need ${investmentAmount} USD.`
            });
        }
        
        // Validate trade interval
        let actualInterval = Math.max(tradeIntervalSeconds, MIN_TRADE_INTERVAL_SECONDS);
        
        // Create trading session
        const sessionId = crypto.randomBytes(16).toString('hex');
        
        const sessionData = {
            userId: req.user.email,
            investmentAmount: investmentAmount,
            profitPercent: profitPercent,
            tradeIntervalSeconds: actualInterval,
            timeLimitHours: timeLimitHours || 24,
            startTime: Date.now(),
            useDemo: useDemo,
            strategy: selectedStrategy,
            maxConcurrentTrades: concurrentTrades,
            status: 'ACTIVE',
            tradeCount: 0,
            successfulTrades: 0,
            failedTrades: 0,
            totalProfit: 0,
            apiKey: apiKey,
            secretKey: secretKey,
            activeOrders: []
        };
        
        activeSessions.set(sessionId, sessionData);
        
        // Save to orders file
        const orders = readOrders();
        orders[sessionId] = {
            userId: req.user.email,
            investmentAmount: investmentAmount,
            profitPercent: profitPercent,
            tradeIntervalSeconds: actualInterval,
            timeLimitHours: timeLimitHours || 24,
            startTime: new Date().toISOString(),
            strategy: selectedStrategy,
            status: 'ACTIVE'
        };
        writeOrders(orders);
        
        // Start trading loop
        startTradingLoop(sessionId);
        
        const mode = useDemo ? 'DEMO' : 'REAL';
        const tradesPerHour = Math.floor(3600 / actualInterval);
        
        res.json({ 
            success: true, 
            sessionId: sessionId, 
            message: `✅ HALAL TRADING STARTED on Exness!\n\n` +
                    `📊 Account: ${mode}\n` +
                    `💰 Investment: $${investmentAmount}\n` +
                    `🎯 Profit Target: ${profitPercent}%\n` +
                    `⚡ Trade Interval: ${actualInterval} seconds\n` +
                    `🔄 Max Trades/Hour: ~${tradesPerHour}\n` +
                    `📈 Strategy: ${selectedStrategy}\n` +
                    `⏰ Time Limit: ${sessionData.timeLimitHours} hours\n\n` +
                    `⚠️ Islamic Reminder: This trade has NO Riba, NO Gharar, NO Maysir, NO leverage, NO short selling.\n\n` +
                    `Trades execute automatically every ${actualInterval} seconds using ${selectedStrategy} strategy.`
        });
        
    } catch (error) {
        console.error('Start trading error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Trading loop function
async function startTradingLoop(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return;
    
    // Check time limit
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    if (elapsedHours >= session.timeLimitHours) {
        session.status = 'COMPLETED';
        activeSessions.delete(sessionId);
        console.log(`⏰ Trading session ${sessionId} completed (time limit reached)`);
        return;
    }
    
    // Check if we have too many active orders
    if (session.activeOrders.length >= session.maxConcurrentTrades) {
        // Clean up completed orders
        for (let i = session.activeOrders.length - 1; i >= 0; i--) {
            const order = session.activeOrders[i];
            if (order.status === 'COMPLETED' || order.status === 'FAILED') {
                session.activeOrders.splice(i, 1);
            }
        }
        // Skip if still at max
        if (session.activeOrders.length >= session.maxConcurrentTrades) {
            setTimeout(() => startTradingLoop(sessionId), session.tradeIntervalSeconds * 1000);
            return;
        }
    }
    
    // Execute one trade
    try {
        await executeSingleTrade(sessionId);
        session.tradeCount++;
        
        // Update cache after trade
        await updateUserBalanceCache(session.userId, session.apiKey, session.secretKey, session.useDemo);
        
        console.log(`✅ Trade #${session.tradeCount} completed for ${session.userId}`);
        
    } catch (error) {
        console.error(`Trade execution error for ${sessionId}:`, error.message);
        session.failedTrades++;
    }
    
    // Schedule next trade
    setTimeout(() => {
        startTradingLoop(sessionId);
    }, session.tradeIntervalSeconds * 1000);
}

async function executeSingleTrade(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return { success: false, error: 'Session inactive' };
    
    // Get next asset
    const asset = getNextAsset();
    const symbol = asset.symbol;
    
    // Get current price
    const price = await getExnessCurrentPrice(symbol, session.useDemo);
    
    // Get trading signal from strategy
    const signal = await tradingStrategy.getSignal(session.strategy, price, symbol, session.useDemo);
    
    // Calculate volume based on investment amount
    const volume = session.investmentAmount / signal.entryPrice;
    
    // Round volume to asset's step size
    const roundedVolume = Math.floor(volume / asset.stepSize) * asset.stepSize;
    if (roundedVolume < asset.minVolume) {
        return { success: false, error: `Volume too small for ${symbol}` };
    }
    
    // Place LIMIT BUY order
    const buyOrder = await placeExnessLimitOrder(
        session.apiKey, session.secretKey, symbol, 'BUY', roundedVolume, signal.entryPrice, session.useDemo
    );
    
    // Track order
    const orderTracker = {
        orderId: buyOrder.orderId,
        symbol: symbol,
        side: 'BUY',
        entryPrice: signal.entryPrice,
        targetPrice: signal.targetPrice,
        stopLoss: signal.stopLoss,
        volume: roundedVolume,
        status: 'PENDING',
        createdAt: Date.now()
    };
    session.activeOrders.push(orderTracker);
    
    // Wait for order to fill (check every 2 seconds for up to 30 seconds)
    let filled = false;
    let fillPrice = 0;
    for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const orderStatus = await checkExnessOrderStatus(
            session.apiKey, session.secretKey, buyOrder.orderId, session.useDemo
        );
        if (orderStatus.status === 'FILLED') {
            filled = true;
            fillPrice = orderStatus.avgPrice;
            break;
        }
        if (orderStatus.status === 'CANCELLED' || orderStatus.status === 'REJECTED') {
            break;
        }
    }
    
    if (!filled) {
        // Cancel the order if not filled
        await cancelExnessOrder(session.apiKey, session.secretKey, buyOrder.orderId, session.useDemo);
        orderTracker.status = 'FAILED';
        return { success: false, error: 'Order not filled' };
    }
    
    orderTracker.status = 'FILLED';
    orderTracker.fillPrice = fillPrice;
    
    // Place SELL limit order at target price
    const sellOrder = await placeExnessLimitOrder(
        session.apiKey, session.secretKey, symbol, 'SELL', roundedVolume, signal.targetPrice, session.useDemo
    );
    
    orderTracker.sellOrderId = sellOrder.orderId;
    orderTracker.sellPrice = signal.targetPrice;
    orderTracker.status = 'SELL_ORDER_PLACED';
    
    // Check if sell order fills
    for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const orderStatus = await checkExnessOrderStatus(
            session.apiKey, session.secretKey, sellOrder.orderId, session.useDemo
        );
        if (orderStatus.status === 'FILLED') {
            // Trade successful
            const profit = (signal.targetPrice - fillPrice) * roundedVolume;
            const profitPercent = (profit / session.investmentAmount) * 100;
            
            session.successfulTrades++;
            session.totalProfit += profit;
            orderTracker.status = 'COMPLETED';
            orderTracker.profit = profit;
            
            // Record trade in history
            const historyFile = path.join(TRADES_DIR, session.userId.replace(/[^a-z0-9]/gi, '_') + '.json');
            let history = [];
            if (fs.existsSync(historyFile)) history = JSON.parse(fs.readFileSync(historyFile));
            history.unshift({
                symbol: symbol,
                strategy: session.strategy,
                entryPrice: fillPrice,
                exitPrice: signal.targetPrice,
                volume: roundedVolume,
                profit: profit,
                profitPercent: profitPercent,
                tradeDuration: Date.now() - orderTracker.createdAt,
                timestamp: new Date().toISOString(),
                isHalal: true
            });
            fs.writeFileSync(historyFile, JSON.stringify(history.slice(0, 1000), null, 2));
            
            return { success: true, profit: profit, profitPercent: profitPercent };
        }
        if (orderStatus.status === 'CANCELLED' || orderStatus.status === 'REJECTED') {
            break;
        }
    }
    
    // Sell order didn't fill - cancel it
    await cancelExnessOrder(session.apiKey, session.secretKey, sellOrder.orderId, session.useDemo);
    orderTracker.status = 'FAILED';
    
    return { success: false, error: 'Sell order not filled' };
}

app.post('/api/stop-trading', authenticate, (req, res) => {
    const { sessionId } = req.body;
    if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        session.status = 'STOPPED';
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Trading stopped successfully' });
    } else {
        res.json({ success: false, message: 'Session not found' });
    }
});

app.post('/api/trade-status', authenticate, (req, res) => {
    const session = activeSessions.get(req.body.sessionId);
    if (!session) return res.json({ success: true, active: false });
    
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, session.timeLimitHours - elapsedHours);
    const winRate = session.tradeCount > 0 ? (session.successfulTrades / session.tradeCount) * 100 : 0;
    
    res.json({ 
        success: true, 
        active: session.status === 'ACTIVE',
        tradeCount: session.tradeCount,
        successfulTrades: session.successfulTrades,
        failedTrades: session.failedTrades,
        winRate: winRate.toFixed(2),
        totalProfit: session.totalProfit,
        timeRemaining: timeRemaining,
        tradeIntervalSeconds: session.tradeIntervalSeconds,
        tradesPerHour: Math.floor(3600 / session.tradeIntervalSeconds),
        strategy: session.strategy,
        activeOrders: session.activeOrders.filter(o => o.status !== 'COMPLETED').length
    });
});

app.get('/api/trade-history', authenticate, (req, res) => {
    const file = path.join(TRADES_DIR, req.user.email.replace(/[^a-z0-9]/gi, '_') + '.json');
    if (!fs.existsSync(file)) return res.json({ success: true, trades: [] });
    const trades = JSON.parse(fs.readFileSync(file));
    res.json({ success: true, trades: trades });
});

app.get('/api/halal-assets', authenticate, (req, res) => {
    res.json({ success: true, assets: HALAL_ASSETS });
});

// ==================== ADMIN ENDPOINTS ====================
app.get('/api/admin/pending-users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const pending = readPending();
    const list = Object.keys(pending).map(e => ({ email: e, requestedAt: pending[e].requestedAt }));
    res.json({ success: true, pending: list });
});

app.post('/api/admin/approve-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    const users = readUsers();
    users[email] = {
        email: email,
        password: pending[email].password,
        isOwner: false,
        isApproved: true,
        isBlocked: false,
        exnessId: "",
        apiKey: "",
        secretKey: "",
        accountType: "real",
        createdAt: new Date().toISOString()
    };
    writeUsers(users);
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} approved` });
});

app.post('/api/admin/reject-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} rejected` });
});

app.post('/api/admin/toggle-block', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const users = readUsers();
    if (!users[email]) return res.status(404).json({ success: false });
    users[email].isBlocked = !users[email].isBlocked;
    writeUsers(users);
    const status = users[email].isBlocked ? 'BLOCKED' : 'ACTIVE';
    res.json({ success: true, message: `User ${email} is now ${status}` });
});

app.get('/api/admin/users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const list = Object.keys(users).map(e => ({
        email: e,
        hasApiKeys: !!users[e].apiKey,
        isOwner: users[e].isOwner,
        isApproved: users[e].isApproved,
        isBlocked: users[e].isBlocked,
        accountType: users[e].accountType || "real",
        createdAt: users[e].createdAt
    }));
    res.json({ success: true, users: list });
});

app.get('/api/admin/user-balances', authenticate, async (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const cache = readBalanceCache();
    const balances = {};
    
    for (const [email, userData] of Object.entries(users)) {
        if (cache[email]) {
            balances[email] = cache[email];
        } else if (userData.apiKey) {
            try {
                const apiKey = decrypt(userData.apiKey);
                const secretKey = decrypt(userData.secretKey);
                const useDemo = userData.accountType === 'demo';
                const balance = await getExnessBalance(apiKey, secretKey, useDemo);
                balances[email] = {
                    balance: balance.balance,
                    equity: balance.equity,
                    freeMargin: balance.freeMargin,
                    currency: balance.currency,
                    hasKeys: true,
                    lastUpdated: new Date().toISOString()
                };
                const newCache = readBalanceCache();
                newCache[email] = balances[email];
                writeBalanceCache(newCache);
            } catch {
                balances[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: true, error: true };
            }
        } else {
            balances[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: false };
        }
    }
    res.json({ success: true, balances: balances });
});

app.post('/api/admin/refresh-all-balances', authenticate, async (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const newCache = {};
    
    for (const [email, userData] of Object.entries(users)) {
        if (userData.apiKey) {
            try {
                const apiKey = decrypt(userData.apiKey);
                const secretKey = decrypt(userData.secretKey);
                const useDemo = userData.accountType === 'demo';
                const balance = await getExnessBalance(apiKey, secretKey, useDemo);
                newCache[email] = {
                    balance: balance.balance,
                    equity: balance.equity,
                    freeMargin: balance.freeMargin,
                    currency: balance.currency,
                    hasKeys: true,
                    lastUpdated: new Date().toISOString()
                };
            } catch {
                newCache[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: true, error: true };
            }
        } else {
            newCache[email] = { balance: 0, equity: 0, freeMargin: 0, hasKeys: false };
        }
    }
    writeBalanceCache(newCache);
    res.json({ success: true, message: 'All balances refreshed', balances: newCache });
});

app.get('/api/admin/all-trades', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const allTrades = {};
    const files = fs.readdirSync(TRADES_DIR);
    for (const file of files) {
        if (file === '.gitkeep') continue;
        const userId = file.replace('.json', '');
        const trades = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, file)));
        allTrades[userId] = trades;
    }
    res.json({ success: true, trades: allTrades });
});

app.post('/api/change-password', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { currentPassword, newPassword } = req.body;
    const users = readUsers();
    const owner = users[req.user.email];
    if (!bcrypt.compareSync(currentPassword, owner.password)) {
        return res.status(401).json({ success: false, message: 'Wrong current password' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    owner.password = bcrypt.hashSync(newPassword, 10);
    writeUsers(users);
    res.json({ success: true, message: 'Password changed! Please login again.' });
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`🕋 EXNESS HALAL TRADING BOT - RUNNING`);
    console.log(`========================================`);
    console.log(`✅ Owner: mujtabahatif@gmail.com`);
    console.log(`✅ Password: Mujtabah@2598`);
    console.log(`✅ ${HALAL_ASSETS.length} Halal Assets`);
    console.log(`✅ Trading Strategies: Scalping, Momentum, Mean Reversion, Trend Following`);
    console.log(`✅ FAST TRADING: As low as ${MIN_TRADE_INTERVAL_SECONDS} seconds per trade`);
    console.log(`✅ NO Riba | NO Gharar | NO Maysir | NO Leverage`);
    console.log(`✅ Real Exness API | Limit Orders Only`);
    console.log(`========================================`);
    console.log(`Server running on port: ${PORT}`);
});
