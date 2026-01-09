const express = require('express');

const app = express();
const bodyParser = require('body-parser');
const crypto = require('crypto');

app.use(bodyParser.urlencoded({ extended: true }));

// ==========================================
// ⚙️ ตั้งค่าระบบ
// ==========================================
const ADMIN_PASSWORD = 'Outing_random_buddy'; // 🔑 รหัสเข้าหน้าแอดมิน (เปลี่ยนได้)


const { createClient } = require('@libsql/client');

const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

// Ensure Tables Exist
let isDBInitialized = false;
async function initDB() {
    if (isDBInitialized) return;
    try {
        await client.batch([
            `CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT)`,
            `CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, password TEXT, size TEXT, buddy TEXT, checked INTEGER DEFAULT 0)`,
            `CREATE TABLE IF NOT EXISTS exclusions (user1 TEXT, user2 TEXT, PRIMARY KEY (user1, user2))`
        ], 'write');
        
        // Init default state if not exists
        await client.execute({
            sql: "INSERT OR IGNORE INTO system_config (key, value) VALUES ('state', 'REGISTRATION')",
            args: []
        });

        isDBInitialized = true;
    } catch (err) {
        console.error("Failed to init DB:", err);
    }
}

// === DB Access Helpers ===

async function getSystemState() {
    await initDB();
    const rs = await client.execute("SELECT value FROM system_config WHERE key = 'state'");
    return rs.rows.length ? rs.rows[0].value : 'REGISTRATION';
}

async function setSystemState(state) {
    await initDB();
    await client.execute({
        sql: "INSERT INTO system_config (key, value) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        args: [state]
    });
}

async function getMatchedAt() {
    await initDB();
    const rs = await client.execute("SELECT value FROM system_config WHERE key = 'matched_at'");
    return rs.rows.length ? rs.rows[0].value : null;
}

async function setMatchedAt(dateStr) {
    await initDB();
    // ถ้า dateStr เป็น null ให้ลบออก หรือ update เป็น null (แต่ value เป็น TEXT อาจจะเก็บ string 'null' หรือ empty)
    if (!dateStr) {
        await client.execute("DELETE FROM system_config WHERE key = 'matched_at'");
    } else {
        await client.execute({
            sql: "INSERT INTO system_config (key, value) VALUES ('matched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            args: [dateStr]
        });
    }
}

async function getAllUsers() {
    await initDB();
    const rs = await client.execute("SELECT * FROM users");
    // แปลงให้ format ใกล้เคียงเดิม เพื่อให้แก้ logic น้อยที่สุด
    // แต่จริงๆ ควรแก้ logic ให้ match กับ sql
    // Return เป็น array ของ object
    return rs.rows; 
}

// เอา exclusion ของ user คนนึง
async function getUserExclusions(name) {
    await initDB();
    const rs = await client.execute({
        sql: "SELECT user2 FROM exclusions WHERE user1 = ?",
        args: [name]
    });
    return rs.rows.map(r => r.user2);
}

// ดึง Users พร้อม Exclude array (สำหรับ logic เดิมที่ต้องการ exclude array ในตัว object)
async function getUsersWithExclusions() {
    const users = await getAllUsers();
    // fetch all exclusions
    const rsEx = await client.execute("SELECT * FROM exclusions");
    
    // Map exclusions to users
    const usersWithEx = users.map(u => ({
        ...u,
        exclude: rsEx.rows.filter(e => e.user1 === u.name).map(e => e.user2)
    }));
    return usersWithEx;
}

// ==========================================
// 🔐 Security Helper (เข้ารหัสรหัสผ่าน)
// ==========================================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    // รองรับของเก่าที่เป็น Plain Text
    if (!storedPassword.includes(':')) {
        return password === storedPassword;
    }
    const [salt, originalHash] = storedPassword.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

// ==========================================
// 🧠 Logic การจับคู่ (เหมือนเดิม)
// ==========================================
function generateMatches(users) {
    let isValid = false;
    let receivers = [];
    let attempt = 0;

    // ลองสุ่มสูงสุด 1000 รอบ ถ้าไม่ได้แสดงว่าเงื่อนไขยากเกินไป
    while (!isValid && attempt < 1000) {
        attempt++;
        receivers = [...users].sort(() => Math.random() - 0.5);
        isValid = users.every((giver, index) => {
            const receiver = receivers[index];
            if (giver.name === receiver.name) return false; // ห้ามจับได้ตัวเอง
            if (giver.exclude && giver.exclude.includes(receiver.name)) return false; // ห้ามจับได้แฟน
            return true;
        });
    }

    if (!isValid) return null; // หาคู่ไม่ได้

    const result = {};
    users.forEach((giver, index) => {
        result[giver.name] = receivers[index].name;
    });
    return result;
}

// ==========================================
// 🎨 HTML Template (ส่วนหน้าเว็บ)
// ==========================================
const style = `
    <style>
        body { font-family: 'Prompt', sans-serif; text-align: center; padding: 20px; background: #f0f2f5; color: #333; }
        .container { background: white; max-width: 450px; margin: auto; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; }
        input:not([type="radio"]), select, button { width: 100%; padding: 12px; margin: 8px 0; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; font-size: 16px; }
        button { background: #007bff; color: white; border: none; font-weight: bold; cursor: pointer; }
        button:hover { background: #0056b3; }
        .admin-btn { background: #6c757d; margin-top: 20px; font-size: 14px; width: auto; padding: 5px 15px; }
        .tag { display: inline-block; background: #eee; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 2px; }
        .alert { color: red; font-size: 14px; }
        .popup-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .popup-box { background: white; padding: 30px; border-radius: 15px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); animation: popin 0.3s; max-width: 300px; width: 90%; }
        @keyframes popin { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;500&display=swap" rel="stylesheet">
`;

// ==========================================
// 🛣️ Routes (เส้นทางของเว็บ)
// ==========================================

// 1. หน้าแรก (เปลี่ยนตามสถานะ)
// 1. หน้าแรก (เปลี่ยนตามสถานะ)
app.get('/', async (req, res) => {
    const state = await getSystemState();
    const showPopup = req.query.registered === '1';
    const popupHtml = showPopup ? `
        <div class="popup-overlay" onclick="window.history.replaceState({}, document.title, '/'); this.remove();">
            <div class="popup-box" onclick="event.stopPropagation()">
                <div style="font-size: 50px;">✅</div>
                <h2 style="margin: 10px 0; color: #28a745;">ลงทะเบียนสำเร็จ!</h2>
                <p style="color: #666;">จำรหัสผ่านไว้ดูผลด้วยนะ</p>
                <button onclick="this.closest('.popup-overlay').click()">ตกลง</button>
            </div>
        </div>
    ` : '';
    
    if (state === 'REGISTRATION') {
        const users = await getAllUsers();
        // แสดงหน้าลงทะเบียน
        const userList = users.map(u => `<span class="tag">${u.name}</span>`).join(' ');
        res.send(`
            ${style}
            ${popupHtml}
            <div class="container">
                <h1>📝 ลงทะเบียน Buddy</h1>
                <p>กรอกชื่อเล่นและตั้งรหัสผ่านของคุณ</p>
                <form action="/register" method="POST">
                    <input type="text" name="name" placeholder="ชื่อเล่น" required autocomplete="off">
                    <input type="password" name="password" placeholder="ตั้งรหัสผ่าน (เอาไว้ดูผล)" required autocomplete="off">
                    <div style="text-align: left; margin: 5px 0; font-size: 14px; color: #555;">
                        ระบุไซส์แบบ: <br>
                        <input type="radio" name="sizeType" value="std" id="typeStd" checked onclick="toggleSize()" style="width:auto; margin-right:5px;"> <label for="typeStd">ไซส์มาตรฐาน</label>
                        &nbsp;&nbsp;
                        <input type="radio" name="sizeType" value="inch" id="typeInch" onclick="toggleSize()" style="width:auto; margin-right:5px;"> <label for="typeInch">ระบุรอบอก (นิ้ว)</label>
                    </div>

                    <div id="size-std-box">
                        <select name="sizeStd" id="sizeStd">
                            <option value="" disabled selected>เลือกไซส์เสื้อ 👕</option>
                            <option value="XS">XS</option>
                            <option value="S">S</option>
                            <option value="M">M</option>
                            <option value="L">L</option>
                            <option value="XL">XL</option>
                            <option value="2XL">2XL</option>
                            <option value="3XL">3XL</option>
                            <option value="Free Size">Free Size</option>
                        </select>
                    </div>
                    <div id="size-inch-box" style="display:none;">
                        <input type="number" name="sizeInch" id="sizeInch" placeholder="ระบุเลขรอบอก (นิ้ว) เช่น 38, 40">
                    </div>

                    <button type="submit">ลงทะเบียนเข้าร่วม</button>
                </form>
                <script>
                    function toggleSize() {
                        const isStd = document.getElementById('typeStd').checked;
                        const boxStd = document.getElementById('size-std-box');
                        const boxInch = document.getElementById('size-inch-box');
                        const inputStd = document.getElementById('sizeStd');
                        const inputInch = document.getElementById('sizeInch');

                        if (isStd) {
                            boxStd.style.display = 'block';
                            boxInch.style.display = 'none';
                            inputStd.setAttribute('required', 'true');
                            inputInch.removeAttribute('required');
                            inputInch.value = '';
                        } else {
                            boxStd.style.display = 'none';
                            boxInch.style.display = 'block';
                            inputStd.removeAttribute('required');
                            inputInch.setAttribute('required', 'true');
                            inputStd.value = '';
                        }
                    }
                    // Run on load
                    toggleSize();
                </script>
                <hr>
                <p>ผู้เข้าร่วม (${users.length} คน):</p>
                <div>${userList || '- ยังไม่มีคนสมัคร -'}</div>
                <br>
                <a href="/admin"><button class="admin-btn">🔒 เข้าสู่ระบบ Admin</button></a>
            </div>
        `);
    } else {
        // แสดงหน้า Login ดูผล
        res.send(`
            ${style}
            <div class="container">
                <h1>🎁 จับคู่เสร็จสิ้นแล้ว!</h1>
                <p>ใส่ชื่อและรหัสผ่านที่คุณตั้งไว้เพื่อดูผล</p>
                <form action="/check" method="POST">
                    <input type="text" name="name" placeholder="ชื่อเล่นของคุณ" required>
                    <input type="password" name="password" placeholder="รหัสผ่านของคุณ" required>
                    <button type="submit" style="background:#28a745;">เปิดดูชื่อบัดดี้</button>
                </form>
            </div>
        `);
    }
});

// 2. API ลงทะเบียน
app.post('/register', async (req, res) => {
    const state = await getSystemState();
    if (state !== 'REGISTRATION') return res.send('ปิดรับสมัครแล้ว');

    const { name, password, sizeType, sizeStd, sizeInch } = req.body;
    
    let size = sizeStd;
    if (sizeType === 'inch') {
        size = sizeInch ? `รอบอก ${sizeInch} นิ้ว` : 'ไม่ระบุ';
    }
    
    // Insert into DB
    await initDB();
    try {
        await client.execute({
            sql: "INSERT INTO users (name, password, size) VALUES (?, ?, ?)",
            args: [name, hashPassword(password), size]
        });
        res.redirect('/?registered=1');
    } catch (e) {
        // Check if name duplicate (SQLITE_CONSTRAINT)
        if (e.message.includes('CONSTRAINT') || e.code === 'SQLITE_CONSTRAINT') {
            return res.send(`${style}<div class="container"><h3>❌ ชื่อนี้มีคนใช้แล้ว</h3><a href="/">กลับ</a></div>`);
        }
        console.error(e);
        res.send("Error registering");
    }
});

// 3. หน้า Admin Login
app.get('/admin', (req, res) => {
    res.send(`
        ${style}
        <div class="container">
            <h1>🔒 Admin Only</h1>
            <form action="/admin/dashboard" method="POST">
                <input type="password" name="password" placeholder="Admin Password" required>
                <button type="submit">Login</button>
            </form>
            <a href="/">กลับหน้าหลัก</a>
        </div>
    `);
});

// 4. หน้า Admin Dashboard (จัดการคน + จับคู่)
app.post('/admin/dashboard', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Wrong Password');

    const users = await getUsersWithExclusions();
    const state = await getSystemState();
    const matchedAt = await getMatchedAt();
    
    // สร้าง Dropdown รายชื่อ
    const options = users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
    
    // สร้างรายการ Exclusion
    let excludeList = '';
    // Display Unique Pairs only to avoid duplicates in view
    const viewedPairs = new Set();

    users.forEach(u => {
        if (u.exclude && u.exclude.length > 0) {
            u.exclude.forEach(targetName => {
                // Determine unique pair key (sorted)
                const pair = [u.name, targetName].sort().join(':');
                if (viewedPairs.has(pair)) return;
                viewedPairs.add(pair);

                excludeList += `
                    <li style="margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                        <span><b>${u.name}</b> ❌ <b>${targetName}</b></span>
                        <form action="/admin/remove-exclude" method="POST" style="margin:0;">
                            <input type="hidden" name="password" value="${password}">
                            <input type="hidden" name="user1" value="${u.name}">
                            <input type="hidden" name="user2" value="${targetName}">
                            <button type="submit" style="background:#dc3545; padding:2px 8px; font-size:12px; width:auto; margin:0;">ลบ</button>
                        </form>
                    </li>`;
            });
        }
    });

    res.send(`
        ${style}
        <div class="container" style="max-width:600px;">
            <h1>🛠️ จัดการระบบ</h1>
            <p>สถานะ: <b>${state}</b> | ผู้เล่น: ${users.length} คน</p>
            
            <details style="margin-bottom: 20px; background: #fff; border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
                <summary style="cursor: pointer; font-weight: bold;">รายชื่อผู้เข้าร่วม (${users.length})</summary>
                <ul style="text-align: left; padding-left: 20px; margin-top: 10px;">
                    ${users.map(u => `
                        <li style="margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                            <span>
                                ${u.name} (${u.size})
                                ${u.checked ? '<span title="เข้ามาดูผลแล้ว" style="cursor:help; margin-left:5px;">👁️</span>' : ''}
                            </span>
                            <form action="/admin/remove-user" method="POST" style="margin:0;" onsubmit="return confirm('ลบ ${u.name} ออกจากระบบ?');">
                                <input type="hidden" name="password" value="${password}">
                                <input type="hidden" name="name" value="${u.name}">
                                <button type="submit" style="background:#dc3545; padding:2px 8px; font-size:12px; width:auto; margin:0;">ลบ</button>
                            </form>
                        </li>
                    `).join('')}
                </ul>
            </details>
            
            <h3>🚫 ตั้งค่าคนที่เป็นแฟนกัน (ห้ามจับได้กัน)</h3>
            <form action="/admin/add-exclude" method="POST" style="background:#eee; padding:15px; border-radius:8px;">
                <input type="hidden" name="password" value="${password}">
                <div style="display:flex; gap:10px;">
                    <select name="user1"><option disabled selected>เลือกคนแรก</option>${options}</select>
                    <span style="padding-top:15px;">❌</span>
                    <select name="user2"><option disabled selected>เลือกคนที่ห้ามเจอ</option>${options}</select>
                </div>
                <button type="submit" style="background:#6c757d;">เพิ่มเงื่อนไข</button>
            </form>
            <ul>${excludeList}</ul>

            <hr>
            <hr>
            ${state === 'MATCHED' ? `
                <h3>✅ จับคู่เรียบร้อยแล้ว</h3>
                <p>เมื่อ: <b>${matchedAt ? new Date(matchedAt).toLocaleString('th-TH') : 'ไม่ระบุเวลา'}</b></p>
                <div style="background:#d4edda; color:#155724; padding:15px; border-radius:8px; margin-top:10px;">
                    ระบบปิดรับสมัครและจับคู่เสร็จสิ้นแล้ว
                </div>
            ` : `
                <h3>🎲 กดเพื่อเริ่มจับคู่</h3>
                <p class="alert">คำเตือน: กดแล้วจะปิดรับสมัครทันที และแก้ไขไม่ได้</p>
                <form action="/admin/match" method="POST">
                    <input type="hidden" name="password" value="${password}">
                    <button type="submit" style="background:#dc3545; font-size:18px;">🚀 Random Matching!</button>
                </form>
            `}

            <hr>
            <h3>⚠️ ล้างระบบใหม่</h3>
            <p class="alert">ลบข้อมูลทั้งหมด เริ่มต้นใหม่ (สำหรับปีถัดไป)</p>
            <form action="/admin/reset" method="POST" onsubmit="return confirm('ยืนยันล้างข้อมูลทั้งหมด? หายหมดเลยนะ!');">
                <input type="hidden" name="password" value="${password}">
                <button type="submit" style="background:black;">💣 Reset System</button>
            </form>
             <br>
            <a href="/">กลับหน้าหลัก</a>
        </div>
    `);
});

// 5. API เพิ่มเงื่อนไขแฟน
app.post('/admin/add-exclude', async (req, res) => {
    const { user1, user2, password } = req.body;
    await initDB();

    if (user1 && user2 && user1 !== user2) {
        // เพิ่มเงื่อนไขทั้งสองฝั่ง (ไป-กลับ)
        try {
            await client.batch([
                { sql: "INSERT OR IGNORE INTO exclusions (user1, user2) VALUES (?, ?)", args: [user1, user2] },
                { sql: "INSERT OR IGNORE INTO exclusions (user1, user2) VALUES (?, ?)", args: [user2, user1] }
            ], 'write');
        } catch (e) {
            console.error(e);
        }
    }
    // Hack: ส่งกลับไปหน้า Dashboard
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// APIs ลบเงื่อนไขแฟน
app.post('/admin/remove-exclude', async (req, res) => {
    const { user1, user2, password } = req.body;
    await initDB();

    if (user1 && user2) {
        try {
            await client.batch([
                { sql: "DELETE FROM exclusions WHERE user1 = ? AND user2 = ?", args: [user1, user2] },
                { sql: "DELETE FROM exclusions WHERE user1 = ? AND user2 = ?", args: [user2, user1] }
            ], 'write');
        } catch (e) {
            console.error(e);
        }
    }
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// APIs ลบ User
app.post('/admin/remove-user', async (req, res) => {
    const { name, password } = req.body;
    await initDB();

    if (name) {
        try {
            await client.batch([
                { sql: "DELETE FROM users WHERE name = ?", args: [name] },
                { sql: "DELETE FROM exclusions WHERE user1 = ? OR user2 = ?", args: [name, name] }
            ], 'write');
        } catch (e) {
            console.error(e);
        }
    }
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// 6. API ประมวลผลจับคู่ (The Magic Moment)
app.post('/admin/match', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Auth Failed');
    
    const state = await getSystemState();
    if (state === 'MATCHED') return res.send('ระบบจับคู่ไปแล้ว ไม่สามารถจับคู่ซ้ำได้');
    
    const users = await getUsersWithExclusions();
    if (users.length < 2) return res.send('คนน้อยไป จับคู่ไม่ได้');

    console.log('Admin สั่งจับคู่...');
    const matches = generateMatches(users); // Return { giverName: receiverName }

    if (!matches) {
        return res.send(`${style}<div class="container"><h3>❌ จับคู่ไม่สำเร็จ!</h3><p>เงื่อนไขเยอะเกินไป หรือจำนวนคนไม่สอดคล้อง ลองลบเงื่อนไขแฟนออกบ้าง</p><a href="/">กลับ</a></div>`);
    }

    // Update DB transactions
    await initDB();
    const stmts = [];
    
    // Update each user's buddy
    for (const [giver, receiver] of Object.entries(matches)) {
        stmts.push({
            sql: "UPDATE users SET buddy = ? WHERE name = ?",
            args: [receiver, giver]
        });
    }

    // Update system state
    const now = new Date().toISOString();
    stmts.push({ sql: "INSERT OR REPLACE INTO system_config (key, value) VALUES ('state', 'MATCHED')", args: [] });
    stmts.push({ sql: "INSERT OR REPLACE INTO system_config (key, value) VALUES ('matched_at', ?)", args: [now] });

    try {
        await client.batch(stmts, 'write');
    } catch (e) {
        console.error(e);
        return res.send("Error saving matches");
    }

    res.send(`${style}<div class="container"><h1>✅ จับคู่สำเร็จ!</h1><p>ระบบปิดรับสมัครแล้ว แจ้งให้ทุกคนเข้าเว็บมาดูผลได้เลย</p><a href="/">ไปหน้าแรก</a></div>`);
});

// 7. API ล้างระบบ (Reset)
app.post('/admin/reset', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Auth Failed');

    await initDB();
    try {
        await client.batch([
            "DELETE FROM users",
            "DELETE FROM exclusions",
            "INSERT OR REPLACE INTO system_config (key, value) VALUES ('state', 'REGISTRATION')",
            "DELETE FROM system_config WHERE key = 'matched_at'"
        ], 'write');
    } catch (e) {
        console.error(e);
    }
    
    res.send(`${style}<div class="container"><h1>🗑️ ล้างระบบเรียบร้อย</h1><p>พร้อมสำหรับเริ่มเกมใหม่แล้ว</p><a href="/">ไปหน้าแรก</a></div>`);
});

// 8. API User ดูผล
app.post('/check', async (req, res) => {
    const { name, password } = req.body;
    await initDB();
    
    try {
        // Fetch user info
        const rsUser = await client.execute({ sql: "SELECT * FROM users WHERE name = ?", args: [name] });
        if (rsUser.rows.length === 0) return res.send(`${style}<div class="container"><h3>❌ ไม่พบชื่อในระบบ</h3><a href="/">กลับ</a></div>`);
        
        const user = rsUser.rows[0];

        if (!verifyPassword(password, user.password)) {
            return res.send(`${style}<div class="container"><h3>❌ รหัสผ่านผิด</h3><a href="/">ลองใหม่</a></div>`);
        }

        // Check Match Status
        const state = await getSystemState();
        if (state !== 'MATCHED' || !user.buddy) return res.send('ระบบยังไม่จับคู่ หรือคุณไม่มีคู่');
        
        // Fetch Buddy Info to get size
        const rsBuddy = await client.execute({ sql: "SELECT * FROM users WHERE name = ?", args: [user.buddy] });
        const buddyData = rsBuddy.rows[0];
        const buddySize = buddyData ? buddyData.size : 'ไม่ระบุ';

        // Update checked status
        if (!user.checked) {
            await client.execute({ sql: "UPDATE users SET checked = 1 WHERE name = ?", args: [name] });
        }

        res.send(`
            ${style}
            <div class="container" style="background:#e8f5e9;">
                <h1>🎉 ผลการจับคู่</h1>
                <p>สวัสดีคุณ <b>${name}</b></p>
                <p>บัดดี้ที่คุณต้องดูแลคือ...</p>
                <h1 style="color:#2e7d32; font-size:45px; margin:20px 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.1);">${user.buddy}</h1>
                
                <div style="background: white; padding: 15px; border-radius: 12px; margin: 20px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                    <span style="font-size: 14px; color: #666; display: block; margin-bottom: 5px;">สิ่งที่บัดดี้อยากได้ (ไซส์เสื้อ)</span>
                    <div style="font-size: 24px; color: #333; font-weight: bold;">
                        👕 ${buddySize}
                    </div>
                </div>

                <p style="color:#666; font-size: 14px;">🤫 เงียบไว้นะ ห้ามบอกใคร!</p>
                <a href="/"><button style="margin-top: 10px;">กลับหน้าหลัก</button></a>
            </div>
        `);
    } catch (e) {
        console.error(e);
        res.send("Error checking results");
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(3000, '0.0.0.0', () => {
        console.log('Server started on port 3000');
    });
}