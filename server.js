const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');

const app = express();

// —— CORS 配置 ——
// 线上允许域名访问（如果不再需要本地调试，可以删掉 localhost 那一行）
app.use(cors({
  origin: [
    'https://spyccb.top',
    'https://www.spyccb.top',
    'http://spyccb.top',     // http 也放行，便于测试
    'http://www.spyccb.top'
  ],
  methods: ['GET','POST','DELETE']
}));

app.use(bodyParser.json());

// Health check on root of API
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ------------ 词库持久化加载 ------------
const DATA_FILE = path.resolve(__dirname, 'wordlists.json');
// 如果文件不存在，先创建一个空对象
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf-8');
}

let wordLists;
try {
  wordLists = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
} catch (e) {
  console.error('Failed to parse wordlists.json, resetting.', e);
  wordLists = {};
}

// Helper：修改后写回磁盘
function saveWordLists() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(wordLists, null, 2), 'utf-8');
}

// 默认词库（首次启动时自动填充）
if (!wordLists.default) {
  wordLists.default = [
    '苹果,梨',
    '猫,老鼠',
    '香蕉,葡萄'
  ];
  saveWordLists();
}

// ------------ REST: 词库管理 ------------
app.get('/wordlists', (req, res) => {
  res.json(Object.keys(wordLists));
});

app.post('/wordlists', (req, res) => {
  const { name } = req.body;
  if (!name || wordLists[name]) {
    return res.status(400).json({ error: 'invalid or exists' });
  }
  wordLists[name] = [];
  saveWordLists();
  res.json({});
});

app.delete('/wordlists/:name', (req, res) => {
  delete wordLists[req.params.name];
  saveWordLists();
  res.json({});
});

app.get('/wordlists/:name', (req, res) => {
  res.json(wordLists[req.params.name] || []);
});

app.post('/wordlists/:name/items', (req, res) => {
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: 'invalid' });
  wordLists[req.params.name] = wordLists[req.params.name] || [];
  wordLists[req.params.name].push(item);
  saveWordLists();
  res.json({});
});

app.delete('/wordlists/:name/items', (req, res) => {
  const { item } = req.query;
  wordLists[req.params.name] = (wordLists[req.params.name] || []).filter(i => i !== item);
  saveWordLists();
  res.json({});
});

// ------------ Socket.IO 实时游戏逻辑 ------------
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: [
      'https://spyccb.top',
      'https://www.spyccb.top',
      'http://spyccb.top',
      'http://www.spyccb.top'
    ]
  }
});

let rooms      = {};   // { roomId: { host, listName, players:[{id,name,role,alive}] } }
let votes      = {};   // { roomId: { [fromId]: toId } }
let wordMap    = {};   // { roomId: { [playerId]: { word, role } } }
let spiesMap   = {};   // { roomId: Set<playerIndex> }

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);

  // 创建房间
  socket.on('create-room', ({ roomId, name }) => {
    // 检查房间是否已经存在
    if (rooms[roomId]) {
      socket.emit('room-exists'); // 发送房间已存在的消息
      return;
    }

    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      listName: 'default',
      players: [{ id: socket.id, name, role: null, alive: false }],
      status: 'waiting', // 添加房间状态: waiting, playing, finished
    };
    socket.join(roomId);
    io.to(roomId).emit('room-updated', rooms[roomId]);
  });

  // 加入房间
  socket.on('join-room', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (room && !room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name, role: null, alive: false });
      socket.join(roomId);
      // 修复：如果房主已不在房间，自动指定新房主
      if (!room.players.find(p => p.id === room.host)) {
        room.host = room.players[0].id;
      }
      room.id = roomId;
      io.to(roomId).emit('room-updated', room);
    }
  });

  // 离开房间
  socket.on('leave-room', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    // 从房间移除该玩家
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      socket.leave(roomId);
      
      // 如果房间没有玩家了，删除房间
      if (room.players.length === 0) {
        delete rooms[roomId];
        return;
      }
      
      // 如果离开的是房主，指定新房主
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      
      // 通知房间内其他玩家
      io.to(roomId).emit('room-updated', room);
    }
  });

  // 检查房间状态
  socket.on('check-room-status', ({ roomId }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      callback({ exists: false });
      return;
    }
    
    callback({ 
      exists: true, 
      status: room.status || 'waiting',
      playerCount: room.players.length
    });
  });

  // 踢出玩家
  socket.on('kick-player', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return; // 只有房主可以踢人
    
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      // 通知被踢玩家
      io.to(playerId).emit('kicked-from-room');
      
      // 从房间移除该玩家
      room.players.splice(playerIndex, 1);
      io.sockets.sockets.get(playerId)?.leave(roomId); // 使玩家离开房间
      
      // 通知房间内其他玩家
      io.to(roomId).emit('room-updated', room);
    }
  });

  // 切换词库
  socket.on('change-list', ({ roomId, listName }) => {
    const room = rooms[roomId];
    if (room && wordLists[listName]) {
      room.listName = listName;
      io.to(roomId).emit('room-updated', room);
    }
  });

  // 重置游戏回大厅
  socket.on('reset-game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id) { // 只有房主可以重置游戏
      // 非房主玩家试图重置，不发送警告，直接忽略
      return;
    }
    delete spiesMap[roomId];
    delete wordMap[roomId];
    delete votes[roomId];
    room.players.forEach(p => { p.role = null; p.alive = false; });
    room.status = 'waiting'; // 重置房间状态
    io.to(roomId).emit('room-updated', room);
  });

  // 开始游戏或下一轮
  socket.on('start-game', ({ roomId, spyCount }) => {
    console.log('收到 start-game', { roomId, spyCount, from: socket.id }); // 调试日志
    const room = rooms[roomId];
    if (!room) return;
    // 首轮分配角色
    if (!spiesMap[roomId]) {
      spiesMap[roomId] = new Set();
      while (spiesMap[roomId].size < spyCount) {
        spiesMap[roomId].add(Math.floor(Math.random() * room.players.length));
      }
      room.players.forEach((p, i) => {
        p.role = spiesMap[roomId].has(i) ? 'spy' : 'civilian';
      });
    }
    // 全员存活
    room.players.forEach(p => p.alive = true);
    room.status = 'playing'; // 设置房间状态为游戏中
    io.to(roomId).emit('room-updated', room);
    dealWords(roomId);
  });

  // 显示/隐藏身份
  socket.on('toggle-visibility', ({ roomId, visible }) => {
    io.to(roomId).emit('visibility-updated', { visible });
  });

  // 提交投票
  socket.on('submit-vote', ({ roomId, fromId, toId }) => {
    votes[roomId] = votes[roomId] || {};
    votes[roomId][fromId] = toId;

    const room = rooms[roomId];
    if (!room) return;

    // 检查场上存活人数
    const alivePlayers = room.players.filter(p => p.alive);
    
    // 如果场上只剩下2名玩家，检查是否一平一卧
    if (alivePlayers.length === 2) {
      const spiesAlive = alivePlayers.filter(p => p.role === 'spy').length;
      const civiliansAlive = alivePlayers.filter(p => p.role === 'civilian').length;
      
      // 如果是一平一卧，直接卧底胜利
      if (spiesAlive === 1 && civiliansAlive === 1) {
        // 准备游戏摘要信息
        const summary = {};
        Object.entries(wordMap[roomId]).forEach(([pid, info]) => {
          summary[pid] = info;
        });
        
        // 设置房间状态为已完成
        room.status = 'finished';
        
        // 向房间内所有玩家发送结束消息
        io.to(roomId).emit('round-summary', { summary });
        io.to(roomId).emit('spy-win');
        
        // 清空投票信息
        votes[roomId] = {};
        return;
      }
    }
    
    // 等待所有存活玩家投票
    const aliveCount = alivePlayers.length;
    if (Object.keys(votes[roomId]).length < aliveCount) return;

    // 统计票数
    const tally = {};
    Object.values(votes[roomId]).forEach(id => {
      tally[id] = (tally[id] || 0) + 1;
    });
    const abstain = tally['abstain'] || 0;
    const entries = Object.entries(tally).filter(([id]) => id !== 'abstain');
    const maxVotes = entries.length ? Math.max(...entries.map(([, c]) => c)) : 0;
    const topIds = entries.filter(([, c]) => c === maxVotes).map(([id]) => id);

    // 平局或弃权>=最高票
    if (maxVotes === 0 || topIds.length > 1 || abstain >= maxVotes) {
      io.to(roomId).emit('vote-tie');
      votes[roomId] = {};
      return;
    }

    const eliminatedId = topIds[0];
    const eliminatedRole = room.players.find(p => p.id === eliminatedId).role;

    // 淘出卧底 → 结束
    if (eliminatedRole === 'spy') {
      // 新增：所有玩家都收到 summary
      const summary = {};
      Object.entries(wordMap[roomId]).forEach(([pid, info]) => {
        summary[pid] = info;
      });
      room.status = 'finished'; // 设置房间状态为已完成
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-eliminated', { eliminatedId });
      votes[roomId] = {};
      return;
    }

    // 淘出平民
    room.players.forEach(p => {
      if (p.id === eliminatedId) p.alive = false;
    });

    // 重新检查剩余玩家情况
    const alivePost = room.players.filter(p => p.alive);
    const spiesAlivePost = alivePost.filter(p => p.role === 'spy').length;
    const civiliansAlivePost = alivePost.filter(p => p.role === 'civilian').length;
    
    // 如果现在是两名玩家且一平一卧，卧底胜利
    if (alivePost.length === 2 && spiesAlivePost === 1 && civiliansAlivePost === 1) {
      const summary = {};
      Object.entries(wordMap[roomId]).forEach(([pid, info]) => {
        summary[pid] = info;
      });
      room.status = 'finished'; // 设置房间状态为已完成
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-win');
      votes[roomId] = {};
      return;
    }
    
    // 如果只剩下卧底
    if (spiesAlivePost === 1 && civiliansAlivePost === 0) {
      const summary = {};
      Object.entries(wordMap[roomId]).forEach(([pid, info]) => {
        summary[pid] = info;
      });
      room.status = 'finished'; // 设置房间状态为已完成
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-win');
      votes[roomId] = {};
      return;
    }

    // 给被淘汰玩家看本轮详情
    const summary = {};
    Object.entries(wordMap[roomId]).forEach(([pid, info]) => {
      summary[pid] = info;
    });
    io.to(eliminatedId).emit('round-summary', { summary });

    // 其余存活玩家重新投票
    alivePost.forEach(p => {
      io.to(p.id).emit('start-next-vote');
    });

    votes[roomId] = {};
  });

  // 发牌函数
  function dealWords(roomId) {
    const room = rooms[roomId];
    const list = wordLists[room.listName] || [];
    if (!list.length) return;
    
    // 从词库中随机选择一行词语
    const randomPair = list[Math.floor(Math.random() * list.length)];
    
    // 将词语分割为两个词
    const wordsArray = randomPair.split(',');
    
    // 验证是否有两个词
    if (wordsArray.length !== 2) {
      console.error('Invalid word format, expected "word1,word2"');
      return;
    }
    
    // 随机决定是否交换词语顺序 (50% 的概率)
    const shouldSwap = Math.random() < 0.5;
    
    // 根据是否交换决定平民词和卧底词
    const [cWord, sWord] = shouldSwap ? [wordsArray[1], wordsArray[0]] : [wordsArray[0], wordsArray[1]];
    
    wordMap[roomId] = {};
    room.players.forEach(p => {
      if (!p.alive) return;
      const w = p.role === 'spy' ? sWord : cWord;
      wordMap[roomId][p.id] = { word: w, role: p.role };
      io.to(p.id).emit('deal-words', { word: w, role: p.role });
    });
  }
});

server.listen(3001, () => console.log('Listening on 3001'));
