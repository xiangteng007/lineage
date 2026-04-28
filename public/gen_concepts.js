const fs = require('fs');
const path = require('path');

const baseStyle = `
  <style>
      body {
          background-color: #f0f0f0;
          color: #111;
          font-family: 'Space Grotesk', sans-serif;
          background-image: radial-gradient(#ccc 1px, transparent 1px);
          background-size: 20px 20px;
          margin: 0;
      }
      .brutal-card {
          border: 4px solid #111;
          box-shadow: 6px 6px 0px #111;
          background: #fff;
      }
      .brutal-button {
          border: 4px solid #111;
          box-shadow: 4px 4px 0px #111;
          text-transform: uppercase;
          font-weight: 900;
          transition: transform 0.1s, box-shadow 0.1s;
          cursor: pointer;
      }
      .brutal-button:active {
          transform: translate(4px, 4px);
          box-shadow: 0px 0px 0px #111;
      }
      .brutal-button-primary { background: #ff3333; color: #fff; }
      .brutal-button-secondary { background: #ffe600; color: #111; }
      .brutal-button-dark { background: #111; color: #fff; }
      .brutal-input {
          border: 4px solid #111;
          background: #fff;
          border-radius: 0;
          padding: 10px 14px;
          font-weight: 700;
          width: 100%;
          font-size: 14px;
      }
      .table-container { border: 4px solid #111; background: #fff; box-shadow: 6px 6px 0px #111; }
      table { border-collapse: collapse; width: 100%; text-transform: uppercase; }
      th { border-bottom: 4px solid #111; border-right: 4px solid #111; padding: 12px; font-weight: 900; font-size: 13px; background: #111; color: #fff; text-align: left; }
      td { border-bottom: 2px solid #111; border-right: 2px solid #111; padding: 12px; font-weight: 700; font-size: 13px; }
      .marquee {
          white-space: nowrap; overflow: hidden; border-bottom: 4px solid #111; border-top: 4px solid #111;
          background: #ffe600; padding: 6px 0; font-weight: 900; text-transform: uppercase;
      }
  </style>
`;

const head = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8"/>
  <title>Layout Concept</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700;900&display=swap" rel="stylesheet">
  ${baseStyle}
</head>
<body class="min-h-screen text-[#111]">
`;

const concepts = [
  {
    name: "01_Left_Heavy_Command.html",
    html: `
    <div class="flex h-screen overflow-hidden">
      <!-- Left Heavy Panel -->
      <aside class="w-96 bg-[#111] border-r-8 border-black flex flex-col shadow-[8px_0px_0px_#ff3333] z-10 overflow-y-auto">
        <div class="p-6 bg-[#ffe600] border-b-4 border-black">
          <h1 class="text-3xl font-black uppercase">LINEAGE AI</h1>
          <p class="font-bold text-xs mt-2 border-t-2 border-black pt-1">TACTICAL LEFT-COMMAND</p>
        </div>
        <nav class="p-4 flex flex-col gap-2 border-b-4 border-gray-800">
          <button class="brutal-button brutal-button-secondary py-3 text-left pl-4">MEMBERS_DB</button>
          <button class="brutal-button brutal-button-dark py-3 text-left pl-4">BATTLES_LOG</button>
          <button class="brutal-button brutal-button-dark py-3 text-left pl-4">TREASURY</button>
        </nav>
        <div class="p-6 flex-1 flex flex-col">
          <div class="bg-white p-4 brutal-card">
            <h3 class="font-black border-b-4 border-black pb-2 mb-4">APPEND RECORD</h3>
            <input type="text" class="brutal-input mb-3" placeholder="ID...">
            <select class="brutal-input mb-3"><option>CLASS...</option></select>
            <button class="brutal-button brutal-button-primary w-full py-3">EXECUTE.INSERT</button>
          </div>
        </div>
      </aside>
      <!-- Right Main -->
      <main class="flex-1 flex flex-col bg-[#f0f0f0]">
        <div class="marquee text-black"><span>SYSTEM OPERATIONAL // AWAITING COMMAND</span></div>
        <div class="p-8 flex-1 overflow-y-auto">
          <div class="flex justify-between mb-4">
            <h2 class="text-3xl font-black bg-black text-white px-4 py-2 border-4 border-black inline-block shadow-[6px_6px_0px_#ffe600]">DATA STREAM</h2>
            <div class="brutal-card bg-white px-4 py-2 font-black flex items-center">TOTAL: 142</div>
          </div>
          <div class="table-container">
            <table>
              <thead><tr><th>ID</th><th>CLASS</th><th>TAGS</th><th>ACTION</th></tr></thead>
              <tbody>
                <tr><td>Nova</td><td>Wizard</td><td>Admin</td><td><button class="brutal-button px-2 text-xs bg-[#ffe600]">EDIT</button></td></tr>
                <tr><td>Titan</td><td>Knight</td><td>Vanguard</td><td><button class="brutal-button px-2 text-xs bg-[#ffe600]">EDIT</button></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
    `
  },
  {
    name: "02_Horizontal_Dashboard.html",
    html: `
    <div class="min-h-screen flex flex-col">
      <header class="bg-[#ffe600] border-b-8 border-black p-4 flex justify-between items-center z-10 shadow-[0px_8px_0px_#111]">
        <h1 class="text-4xl font-black uppercase">LINEAGE AI</h1>
        <div class="flex gap-4">
          <button class="brutal-button brutal-button-dark px-6 py-2">MEMBERS</button>
          <button class="brutal-button bg-white px-6 py-2">BATTLES</button>
          <button class="brutal-button bg-white px-6 py-2">TREASURY</button>
        </div>
      </header>
      <div class="p-8 flex flex-col gap-8 flex-1">
        <!-- Horizontal Form Action Row -->
        <div class="brutal-card bg-[#111] p-6 text-white shadow-[8px_8px_0px_#ff3333]">
          <h3 class="font-black uppercase mb-4 text-[#ffe600] border-b-2 border-gray-700 pb-2">QUICK APPEND</h3>
          <div class="flex gap-4 items-end">
            <div class="flex-1">
              <label class="block text-xs font-bold mb-1">ID</label>
              <input type="text" class="brutal-input text-black">
            </div>
            <div class="flex-1">
              <label class="block text-xs font-bold mb-1">CLASS</label>
              <select class="brutal-input text-black"><option>SELECT...</option></select>
            </div>
            <button class="brutal-button brutal-button-primary px-8 py-3">INSERT</button>
          </div>
        </div>
        <!-- Table Row -->
        <div class="flex-1">
          <div class="table-container h-full">
            <table>
              <thead><tr><th>ID</th><th>CLASS</th><th>TAGS</th><th>ACTION</th></tr></thead>
              <tbody>
                <tr><td>Lumi</td><td>Elf</td><td>Sniper</td><td><button class="brutal-button px-2 text-xs bg-[#ffe600]">EDIT</button></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    `
  },
  {
    name: "03_Bottom_Terminal.html",
    html: `
    <div class="h-screen flex flex-col">
      <header class="bg-black text-white p-4 flex justify-between items-center border-b-4 border-[#ffe600]">
        <h1 class="text-2xl font-black">L-AI // TACTICAL</h1>
        <nav class="flex gap-2">
          <button class="brutal-button bg-[#ffe600] text-black px-4 py-1 text-sm">MEMBERS</button>
          <button class="brutal-button bg-white text-black px-4 py-1 text-sm">BATTLES</button>
        </nav>
      </header>
      
      <!-- Main Table Area -->
      <main class="flex-1 overflow-auto p-6 bg-[#f0f0f0]">
        <div class="table-container mb-24">
          <table>
            <thead><tr><th>TIMESTAMP</th><th>ID</th><th>CLASS</th><th>STATUS</th></tr></thead>
            <tbody>
              <tr><td>2026-04-28 10:00</td><td>Rusty</td><td>Prince</td><td>ACTIVE</td></tr>
              <tr><td>2026-04-28 10:05</td><td>Argus</td><td>Dark Elf</td><td>ACTIVE</td></tr>
            </tbody>
          </table>
        </div>
      </main>

      <!-- Bottom Fixed Terminal/Form -->
      <div class="fixed bottom-0 left-0 w-full bg-[#111] border-t-8 border-[#ff3333] p-4 text-white z-50">
        <div class="max-w-6xl mx-auto flex gap-4 items-center">
          <span class="text-[#ffe600] font-black text-xl">></span>
          <input type="text" class="brutal-input bg-transparent border-2 border-gray-700 text-[#ffe600] font-mono flex-1 focus:bg-gray-900" placeholder="ENTER ID...">
          <select class="brutal-input w-48 text-black"><option>CLASS</option></select>
          <button class="brutal-button brutal-button-primary px-8 py-3">EXECUTE</button>
        </div>
      </div>
    </div>
    `
  },
  {
    name: "04_Grid_Panels.html",
    html: `
    <div class="min-h-screen p-8 bg-[#f0f0f0]">
      <header class="mb-8 border-4 border-black bg-white p-4 flex justify-between shadow-[8px_8px_0px_#111]">
        <h1 class="text-4xl font-black">L_AI Grid</h1>
        <button class="brutal-button brutal-button-dark px-4">SYS.LOGIN</button>
      </header>
      
      <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
        <!-- Nav Widget -->
        <div class="md:col-span-3 brutal-card bg-[#ffe600] p-4 flex flex-col gap-2 h-fit">
          <h3 class="font-black border-b-4 border-black pb-2 mb-2">MODULES</h3>
          <button class="brutal-button brutal-button-dark py-2">MEMBERS</button>
          <button class="brutal-button bg-white py-2">BATTLES</button>
        </div>
        
        <!-- Action Widget -->
        <div class="md:col-span-4 brutal-card bg-white p-4 h-fit border-l-8 border-[#ff3333]">
          <h3 class="font-black border-b-4 border-black pb-2 mb-4 uppercase">New Entry</h3>
          <input type="text" class="brutal-input mb-2" placeholder="ID...">
          <select class="brutal-input mb-4"><option>CLASS</option></select>
          <button class="brutal-button brutal-button-primary w-full py-2">INSERT</button>
        </div>

        <!-- Stats Widget -->
        <div class="md:col-span-5 brutal-card bg-[#111] text-white p-4 h-fit">
          <h3 class="font-black border-b-4 border-gray-700 pb-2 mb-4 text-[#ffe600]">SYSTEM HEALTH</h3>
          <div class="text-4xl font-black">99.9%</div>
          <div class="text-gray-400 text-xs font-bold mt-2">ALL SYSTEMS NOMINAL</div>
        </div>

        <!-- Table Widget -->
        <div class="md:col-span-12 table-container mt-4">
          <table>
            <thead><tr><th>ID</th><th>CLASS</th><th>TAGS</th></tr></thead>
            <tbody><tr><td>Nova</td><td>Wizard</td><td>Admin</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
    `
  },
  {
    name: "05_Focus_Modal.html",
    html: `
    <div class="h-screen flex flex-col relative overflow-hidden">
      <!-- Minimal Header -->
      <header class="bg-white border-b-4 border-black p-4 flex justify-between items-center shadow-md">
        <div class="flex gap-4 items-center">
          <h1 class="text-2xl font-black bg-black text-white px-2">LAI</h1>
          <nav class="flex gap-4 font-bold text-sm">
            <a href="#" class="border-b-4 border-[#ffe600]">MEMBERS</a>
            <a href="#" class="border-b-4 border-transparent hover:border-black">BATTLES</a>
          </nav>
        </div>
        <button class="brutal-button brutal-button-primary px-4 py-2" onclick="document.getElementById('focusModal').style.display='flex'">+ NEW ENTRY</button>
      </header>
      
      <!-- Full Table -->
      <main class="flex-1 p-8 overflow-auto">
        <div class="table-container">
          <table>
            <thead><tr><th>ID</th><th>CLASS</th><th>TAGS</th></tr></thead>
            <tbody>
              <tr><td>User1</td><td>Knight</td><td>-</td></tr>
              <tr><td>User2</td><td>Elf</td><td>-</td></tr>
            </tbody>
          </table>
        </div>
      </main>

      <!-- Focus Modal Form -->
      <div id="focusModal" class="fixed inset-0 bg-[#ffe600] z-50 flex flex-col p-12" style="display:none;">
        <div class="flex justify-between items-center border-b-8 border-black pb-4 mb-12">
          <h2 class="text-6xl font-black">APPEND RECORD</h2>
          <button class="brutal-button bg-white text-3xl px-4 py-2 border-8 border-black" onclick="document.getElementById('focusModal').style.display='none'">X</button>
        </div>
        <div class="max-w-2xl mx-auto w-full flex flex-col gap-8">
          <div>
            <label class="block text-2xl font-black mb-2">CHARACTER ID</label>
            <input type="text" class="brutal-input text-2xl py-4 border-8 border-black shadow-[8px_8px_0px_#111]">
          </div>
          <div>
            <label class="block text-2xl font-black mb-2">CLASS</label>
            <select class="brutal-input text-2xl py-4 border-8 border-black shadow-[8px_8px_0px_#111]"><option>SELECT...</option></select>
          </div>
          <button class="brutal-button brutal-button-dark text-3xl py-6 mt-8 shadow-[12px_12px_0px_#ff3333]">EXECUTE</button>
        </div>
      </div>
    </div>
    `
  }
];

concepts.forEach(c => {
  const content = head + c.html + '</body></html>';
  fs.writeFileSync(path.join(__dirname, 'concepts', c.name), content);
});

console.log("5 concepts generated successfully.");
