const express = require('express');
const { kv } = require('@vercel/kv'); // ใช้ Vercel KV
const app = express();
const bodyParser = require('body-parser');
const crypto = require('crypto');

app.use(bodyParser.urlencoded({ extended: true }));

// ==========================================
// ⚙️ ตั้งค่าระบบ
// ==========================================
const ADMIN_PASSWORD = 'Outing_random_buddy'; // 🔑 รหัสเข้าหน้าแอดมิน (เปลี่ยนได้)

// ==========================================
// 💾 Database Helper (ระบบจัดการ KV)
// ==========================================
async function getDB() {
    const data = await kv.get('db');
    if (!data) {
        // ค่าเริ่มต้น ถ้ายังไม่มีข้อมูลใน KV
        const initialData = {
            state: 'REGISTRATION', // REGISTRATION หรือ MATCHED
            users: [], // { name, password, exclude: [] }
            matches: null // จะเก็บเป็น base64
        };
        await kv.set('db', initialData);
        return initialData;
    }
    return data;
}

async function saveDB(data) {
    await kv.set('db', data);
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
app.get('/', async (req, res) => {
    const db = await getDB();
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
    
    if (db.state === 'REGISTRATION') {
        // แสดงหน้าลงทะเบียน
        const userList = db.users.map(u => `<span class="tag">${u.name}</span>`).join(' ');
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
                <p>ผู้เข้าร่วม (${db.users.length} คน):</p>
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
    const db = await getDB();
    if (db.state !== 'REGISTRATION') return res.send('ปิดรับสมัครแล้ว');

    const { name, password, sizeType, sizeStd, sizeInch } = req.body;
    
    let size = sizeStd;
    if (sizeType === 'inch') {
        size = sizeInch ? `รอบอก ${sizeInch} นิ้ว` : 'ไม่ระบุ';
    }
    
    // เช็คชื่อซ้ำ
    if (db.users.find(u => u.name === name)) {
        return res.send(`${style}<div class="container"><h3>❌ ชื่อนี้มีคนใช้แล้ว</h3><a href="/">กลับ</a></div>`);
    }

    // บันทึก user
    db.users.push({ name, password: hashPassword(password), size, exclude: [] });
    await saveDB(db);
    res.redirect('/?registered=1');
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

    const db = await getDB();
    
    // สร้าง Dropdown รายชื่อ
    const options = db.users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
    
    // สร้างรายการ Exclusion (ใครห้ามคู่ใคร)
    let excludeList = '';
    db.users.forEach(u => {
        if (u.exclude && u.exclude.length > 0) {
            u.exclude.forEach(targetName => {
                // แสดงเฉพาะขาเดียว (A -> B) เพื่อไม่ให้ซ้ำซ้อน
                if (u.name < targetName) {
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
                }
            });
        }
    });

    res.send(`
        ${style}
        <div class="container" style="max-width:600px;">
            <h1>🛠️ จัดการระบบ</h1>
            <p>สถานะ: <b>${db.state}</b> | ผู้เล่น: ${db.users.length} คน</p>
            
            <details style="margin-bottom: 20px; background: #fff; border: 1px solid #ddd; padding: 10px; border-radius: 8px;">
                <summary style="cursor: pointer; font-weight: bold;">รายชื่อผู้เข้าร่วม (${db.users.length})</summary>
                <ul style="text-align: left; padding-left: 20px; margin-top: 10px;">
                    ${db.users.map(u => `
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
            ${db.state === 'MATCHED' ? `
                <h3>✅ จับคู่เรียบร้อยแล้ว</h3>
                <p>เมื่อ: <b>${db.matchedAt ? new Date(db.matchedAt).toLocaleString('th-TH') : 'ไม่ระบุเวลา'}</b></p>
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
    const db = await getDB();

    if (user1 && user2 && user1 !== user2) {
        // เพิ่มเงื่อนไขทั้งสองฝั่ง (ไป-กลับ)
        const u1 = db.users.find(u => u.name === user1);
        const u2 = db.users.find(u => u.name === user2);
        
        if (u1 && !u1.exclude.includes(user2)) u1.exclude.push(user2);
        if (u2 && !u2.exclude.includes(user1)) u2.exclude.push(user1);
        
        await saveDB(db);
    }
    // Hack: ส่งกลับไปหน้า Dashboard โดยแปะ password ไปด้วย (แบบบ้านๆ)
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// APIs ลบเงื่อนไขแฟน
app.post('/admin/remove-exclude', async (req, res) => {
    const { user1, user2, password } = req.body;
    const db = await getDB();

    if (user1 && user2) {
        const u1 = db.users.find(u => u.name === user1);
        const u2 = db.users.find(u => u.name === user2);

        if (u1) u1.exclude = u1.exclude.filter(n => n !== user2);
        if (u2) u2.exclude = u2.exclude.filter(n => n !== user1);

        await saveDB(db);
    }
    // Hack: ส่งกลับไปหน้า Dashboard
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// APIs ลบ User
app.post('/admin/remove-user', async (req, res) => {
    const { name, password } = req.body;
    const db = await getDB();

    if (name) {
        // ลบ User ออก
        db.users = db.users.filter(u => u.name !== name);
        
        // ลบเงื่อนไขที่มีคนนี้เกี่ยวข้อง
        db.users.forEach(u => {
            if (u.exclude) {
                u.exclude = u.exclude.filter(n => n !== name);
            }
        });

        await saveDB(db);
    }
    // Hack: ส่งกลับไปหน้า Dashboard
    res.send(`<form id="f" action="/admin/dashboard" method="POST"><input type="hidden" name="password" value="${password}"></form><script>document.getElementById("f").submit()</script>`);
});

// 6. API ประมวลผลจับคู่ (The Magic Moment)
app.post('/admin/match', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Auth Failed');
    const db = await getDB();
    
    if (db.state === 'MATCHED') return res.send('ระบบจับคู่ไปแล้ว ไม่สามารถจับคู่ซ้ำได้');
    if (db.users.length < 2) return res.send('คนน้อยไป จับคู่ไม่ได้');

    console.log('Admin สั่งจับคู่...');
    const matches = generateMatches(db.users);

    if (!matches) {
        return res.send(`${style}<div class="container"><h3>❌ จับคู่ไม่สำเร็จ!</h3><p>เงื่อนไขเยอะเกินไป หรือจำนวนคนไม่สอดคล้อง ลองลบเงื่อนไขแฟนออกบ้าง</p><a href="/">กลับ</a></div>`);
    }

    // เข้ารหัสผลลัพธ์เป็น Base64
    const encodedMatches = Buffer.from(JSON.stringify(matches)).toString('base64');

    // บันทึกและเปลี่ยนสถานะ
    db.matches = encodedMatches;
    db.state = 'MATCHED';
    db.matchedAt = new Date().toISOString();
    await saveDB(db);

    res.send(`${style}<div class="container"><h1>✅ จับคู่สำเร็จ!</h1><p>ระบบปิดรับสมัครแล้ว แจ้งให้ทุกคนเข้าเว็บมาดูผลได้เลย</p><a href="/">ไปหน้าแรก</a></div>`);
});

// 7. API ล้างระบบ (Reset)
app.post('/admin/reset', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Auth Failed');

    const db = await getDB();
    
    // รีเซ็ตค่าต่างๆ แต่เก็บ users ไว้
    db.state = 'REGISTRATION';
    db.matches = null;
    delete db.matchedAt;
    
    // รีเซ็ตสถานะการดูผลของทุกคน
    db.users.forEach(u => {
        delete u.checked;
    });

    await saveDB(db);
    
    res.send(`${style}<div class="container"><h1>🗑️ ล้างระบบเรียบร้อย</h1><p>พร้อมสำหรับเริ่มเกมใหม่แล้ว</p><a href="/">ไปหน้าแรก</a></div>`);
});

// 8. API User ดูผล
app.post('/check', async (req, res) => {
    const { name, password } = req.body;
    const db = await getDB();
    
    // ตรวจสอบ Login
    const user = db.users.find(u => u.name === name);
    if (!user || !verifyPassword(password, user.password)) {
        return res.send(`${style}<div class="container"><h3>❌ ชื่อหรือรหัสผ่านผิด</h3><a href="/">ลองใหม่</a></div>`);
    }

    // ถอดรหัสเฉพาะคู่นี้
    if (!db.matches) return res.send('ระบบยังไม่จับคู่');
    
    const allMatches = JSON.parse(Buffer.from(db.matches, 'base64').toString('utf-8'));
    const myBuddy = allMatches[name];
    const buddyData = db.users.find(u => u.name === myBuddy);

    const buddySize = buddyData ? buddyData.size : 'ไม่ระบุ';

    // บันทึกว่าเข้ามาดูแล้ว
    if (!user.checked) {
        user.checked = true;
        await saveDB(db);
    }

    res.send(`
        ${style}
        <div class="container" style="background:#e8f5e9;">
            <h1>🎉 ผลการจับคู่</h1>
            <p>สวัสดีคุณ <b>${name}</b></p>
            <p>บัดดี้ที่คุณต้องดูแลคือ...</p>
            <h1 style="color:#2e7d32; font-size:45px; margin:20px 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.1);">${myBuddy}</h1>
            
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
});

module.exports = app;

if (require.main === module) {
    app.listen(3000, '0.0.0.0', () => {
        console.log('Server started on port 3000');
    });
}