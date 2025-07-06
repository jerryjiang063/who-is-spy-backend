const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');

const app = express();

// 添加简单的请求限制中间件
const requestLimits = {};
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const endpoint = req.path;
  const key = `${ip}:${endpoint}`;
  
  // 初始化或更新请求计数
  if (!requestLimits[key]) {
    requestLimits[key] = {
      count: 1,
      firstRequest: Date.now()
    };
  } else {
    requestLimits[key].count++;
  }
  
  // 检查是否在1秒内发送了超过10个相同请求
  if (Date.now() - requestLimits[key].firstRequest < 1000 && requestLimits[key].count > 10) {
    console.log(`Rate limit exceeded for ${key}`);
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  
  // 重置超过1秒的计数器
  if (Date.now() - requestLimits[key].firstRequest > 1000) {
    requestLimits[key] = {
      count: 1,
      firstRequest: Date.now()
    };
  }
  
  // 清理旧的请求记录（超过5分钟的）
  const now = Date.now();
  Object.keys(requestLimits).forEach(k => {
    if (now - requestLimits[k].firstRequest > 5 * 60 * 1000) {
      delete requestLimits[k];
    }
  });
  
  next();
}

// 应用限流中间件
app.use(rateLimiter);

// —— CORS 配置 ——
// 线上允许域名访问（如果不再需要本地调试，可以删掉 localhost 那一行）
app.use(cors({
  origin: [
    'https://spyccb.top',
    'https://www.spyccb.top',
    'http://spyccb.top',     // http 也放行，便于测试
    'http://www.spyccb.top',
    'https://figurativelanguage.spyccb.top',  // 添加新域名
    'http://figurativelanguage.spyccb.top',   // 添加新域名
    'http://localhost:5173',                  // 添加本地开发环境
    'http://localhost:5174',                  // 添加本地开发环境
    'http://localhost:5175',                  // 添加本地开发环境
    'http://localhost:5176',                  // 添加本地开发环境
    'http://localhost:5177',                  // 添加本地开发环境
    'http://localhost:5178',                  // 添加本地开发环境
    'http://127.0.0.1:5173',                  // 添加本地开发环境
    'http://127.0.0.1:5174',                  // 添加本地开发环境
    'http://127.0.0.1:5175',                  // 添加本地开发环境
    'http://127.0.0.1:5176',                  // 添加本地开发环境
    'http://127.0.0.1:5177',                  // 添加本地开发环境
    'http://127.0.0.1:5178'                   // 添加本地开发环境
  ],
  methods: ['GET','POST','DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Health check on root of API
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ------------ 词库加载 ------------
const DATA_FILE = path.resolve(__dirname, 'wordlists.json');
console.log(`Loading wordlists from: ${DATA_FILE}`);

let wordLists;
try {
  // 直接从文件中读取词库，不添加任何默认内容
  if (fs.existsSync(DATA_FILE)) {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf-8');
    console.log(`Wordlists file exists, size: ${fileContent.length} bytes`);
    wordLists = JSON.parse(fileContent);
    console.log(`Loaded wordlists with ${Object.keys(wordLists).length} categories`);
    
    // 打印每个词库的大小
    Object.keys(wordLists).forEach(key => {
      console.log(`- ${key}: ${wordLists[key].length} word pairs`);
    });
  } else {
    console.log('Wordlists file does not exist, creating empty object');
    wordLists = {};
    fs.writeFileSync(DATA_FILE, JSON.stringify(wordLists, null, 2), 'utf-8');
  }
} catch (e) {
  console.error('Failed to load wordlists:', e);
  wordLists = {};
  fs.writeFileSync(DATA_FILE, JSON.stringify(wordLists, null, 2), 'utf-8');
}

// Helper：修改后写回磁盘
function saveWordLists() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(wordLists, null, 2), 'utf-8');
    console.log('Wordlists saved successfully');
  } catch (e) {
    console.error('Failed to save wordlists:', e);
  }
}

// ------------ 题库加载 ------------
const QUIZ_FILE = path.resolve(__dirname, 'data/quizzes.json');
// 如果题库文件不存在，创建一个空的题库
if (!fs.existsSync(QUIZ_FILE)) {
  fs.writeFileSync(QUIZ_FILE, JSON.stringify({ questions: [] }, null, 2), 'utf-8');
}

let quizzes;
try {
  quizzes = JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf-8'));
} catch (e) {
  console.error('Failed to parse quizzes.json, resetting.', e);
  quizzes = { questions: [] };
}

// ------------ REST: 词库管理 ------------
app.get('/wordlists', (req, res) => {
  try {
    console.log('Wordlists requested');
    // 添加缓存控制头，减少重复请求
    res.set('Cache-Control', 'public, max-age=60'); // 缓存1分钟
    res.json(Object.keys(wordLists));
  } catch (error) {
    console.error('Error in GET /wordlists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/wordlists', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || wordLists[name]) {
      return res.status(400).json({ error: 'invalid or exists' });
    }
    wordLists[name] = [];
    saveWordLists();
    res.json({});
  } catch (error) {
    console.error('Error in POST /wordlists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/wordlists/:name', (req, res) => {
  try {
    delete wordLists[req.params.name];
    saveWordLists();
    res.json({});
  } catch (error) {
    console.error(`Error in DELETE /wordlists/${req.params.name}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/wordlists/:name', (req, res) => {
  try {
    // 添加缓存控制头，减少重复请求
    res.set('Cache-Control', 'public, max-age=60'); // 缓存1分钟
    res.json(wordLists[req.params.name] || []);
  } catch (error) {
    console.error(`Error in GET /wordlists/${req.params.name}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/wordlists/:name/items', (req, res) => {
  try {
    const { item } = req.body;
    if (!item) return res.status(400).json({ error: 'invalid' });
    wordLists[req.params.name] = wordLists[req.params.name] || [];
    wordLists[req.params.name].push(item);
    saveWordLists();
    res.json({});
  } catch (error) {
    console.error(`Error in POST /wordlists/${req.params.name}/items:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/wordlists/:name/items', (req, res) => {
  try {
    const { item } = req.query;
    wordLists[req.params.name] = (wordLists[req.params.name] || []).filter(i => i !== item);
    saveWordLists();
    res.json({});
  } catch (error) {
    console.error(`Error in DELETE /wordlists/${req.params.name}/items:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ------------ REST: 题库管理 ------------
// 获取随机题目 - 只在 figurativelanguage 域名中可用
app.get('/quiz/random', (req, res) => {
  try {
    // 检查请求来源
    const origin = req.get('origin') || '';
    console.log('Quiz random request from origin:', origin);
    
    // 放宽检查条件，允许任何包含 figurativelanguage 的域名
    // 或者本地开发环境访问
    const isFigLang = origin.includes('figurativelanguage') || 
                     origin.includes('localhost') || 
                     origin.includes('127.0.0.1') ||
                     !origin; // 允许没有 origin 的请求（可能是直接从服务器发起的请求）
    
    if (!isFigLang) {
      console.log('Access denied for origin:', origin);
      return res.status(403).json({ error: 'This API is only available on figurativelanguage.spyccb.top' });
    }
    
    if (!quizzes.questions || quizzes.questions.length === 0) {
      return res.status(404).json({ error: 'No questions available' });
    }
    
    // 使用缓存的随机索引，避免频繁计算
    const randomIndex = Math.floor(Math.random() * quizzes.questions.length);
    const question = quizzes.questions[randomIndex];
    
    // 不返回正确答案和解释，这些在提交答案后才返回
    const { correctAnswer, explanation, ...questionData } = question;
    
    // 添加缓存控制头，减少重复请求
    res.set('Cache-Control', 'public, max-age=60'); // 缓存1分钟
    res.json(questionData);
  } catch (error) {
    console.error('Error in /quiz/random:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 提交答案 - 只在 figurativelanguage 域名中可用
app.post('/quiz/submit', (req, res) => {
  try {
    // 检查请求来源
    const origin = req.get('origin') || '';
    console.log('Quiz submit request from origin:', origin);
    
    // 放宽检查条件，允许任何包含 figurativelanguage 的域名
    // 或者本地开发环境访问
    const isFigLang = origin.includes('figurativelanguage') || 
                     origin.includes('localhost') || 
                     origin.includes('127.0.0.1') ||
                     !origin; // 允许没有 origin 的请求（可能是直接从服务器发起的请求）
    
    if (!isFigLang) {
      console.log('Access denied for origin:', origin);
      return res.status(403).json({ error: 'This API is only available on figurativelanguage.spyccb.top' });
    }
    
    const { questionId, answer } = req.body;
    
    if (!questionId || answer === undefined) {
      return res.status(400).json({ error: 'Missing questionId or answer' });
    }
    
    const question = quizzes.questions.find(q => q.id === questionId);
    
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    const isCorrect = question.correctAnswer === answer;
    
    res.json({
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation || ''
    });
  } catch (error) {
    console.error('Error in /quiz/submit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 检测客户端是否来自figurativelanguage域名
function isFigurativeLanguageDomain(socket) {
  const origin = socket.handshake.headers.origin || '';
  const referer = socket.handshake.headers.referer || '';
  const host = socket.handshake.headers.host || '';
  
  console.log(`Origin check - Origin: ${origin}, Referer: ${referer}, Host: ${host}`);
  
  return origin.includes('figurativelanguage') || 
         referer.includes('figurativelanguage') || 
         host.includes('figurativelanguage') ||
         origin.includes('figurativelanguage.spyccb.top') ||
         referer.includes('figurativelanguage.spyccb.top') ||
         host.includes('figurativelanguage.spyccb.top');
}

// ------------ Socket.IO 实时游戏逻辑 ------------
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: [
      'https://spyccb.top',
      'https://www.spyccb.top',
      'http://spyccb.top',
      'http://www.spyccb.top',
      'https://figurativelanguage.spyccb.top',  // 添加新域名
      'http://figurativelanguage.spyccb.top',   // 添加新域名
      'http://localhost:5173',                  // 添加本地开发环境
      'http://localhost:5174',                  // 添加本地开发环境
      'http://localhost:5175',                  // 添加本地开发环境
      'http://localhost:5176',                  // 添加本地开发环境
      'http://localhost:5177',                  // 添加本地开发环境
      'http://localhost:5178',                  // 添加本地开发环境
      'http://127.0.0.1:5173',                  // 添加本地开发环境
      'http://127.0.0.1:5174',                  // 添加本地开发环境
      'http://127.0.0.1:5175',                  // 添加本地开发环境
      'http://127.0.0.1:5176',                  // 添加本地开发环境
      'http://127.0.0.1:5177',                  // 添加本地开发环境
      'http://127.0.0.1:5178'                   // 添加本地开发环境
    ],
    methods: ['GET', 'POST', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  }
});

let rooms      = {};   // { roomId: { host, listName, players:[{id,name,role,alive,inPunishment}] } }
let votes      = {};   // { roomId: { [fromId]: toId } }
let wordMap    = {};   // { roomId: { [playerId]: { word, role } } }
let spiesMap   = {};   // { roomId: Set<playerIndex> }

io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);
  console.log(`Headers: ${JSON.stringify(socket.handshake.headers)}`);
  console.log(`Origin: ${socket.handshake.headers.origin}`);
  console.log(`Host: ${socket.handshake.headers.host}`);
  console.log(`Referer: ${socket.handshake.headers.referer}`);
  console.log(`Is figurative language domain: ${isFigurativeLanguageDomain(socket)}`);
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // 从所有房间中移除玩家
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomId).emit('room-updated', room);
        console.log(`Player ${socket.id} removed from room ${roomId}`);
      }
    });
  });
  
  // 检查客户端来源
  const clientOrigin = socket.handshake.headers.origin || '';
  const isFigLang = clientOrigin.includes('figurativelanguage') || clientOrigin.includes('localhost') || clientOrigin.includes('127.0.0.1');
  
  // 创建房间
  socket.on('create-room', ({ roomId, name, listName }) => {
    console.log(`Create-room event received - Room: ${roomId}, Player: ${name}, List: ${listName}`);
    
    // 检查客户端来源
    const isFigLang = isFigurativeLanguageDomain(socket);
    console.log(`Creating room ${roomId} - isFigLang detected: ${isFigLang}`);
    
    // 如果是figurativelanguage域名，强制使用figurative_language词库
    if (isFigLang && listName !== 'figurative_language') {
      console.log(`Forcing figurative_language list for figLang client in new room ${roomId}`);
      listName = 'figurative_language';
    }
    
    // 确保词库存在
    if (!wordLists[listName]) {
      console.log(`Word list ${listName} not found, defaulting to 'default'`);
      listName = 'default';
    }
    
    // 创建房间
    rooms[roomId] = {
      id: roomId,
      host: socket.id,
      players: [{ id: socket.id, name, role: null, alive: false, inPunishment: false }],
      listName: listName,
      isFigLang: isFigLang,
      gameStarted: false,
      votingStarted: false
    };
    
    socket.join(roomId);
    console.log(`Room ${roomId} created with list: ${listName}, isFigLang: ${isFigLang}`);
    io.to(roomId).emit('room-updated', rooms[roomId]);
  });

  // 加入房间
  socket.on('join-room', ({ roomId, name }) => {
    console.log(`Join-room event received - Room: ${roomId}, Player: ${name}`);
    const room = rooms[roomId];
    if (room && !room.players.find(p => p.id === socket.id)) {
      // 检查客户端来源
      const isFigLang = isFigurativeLanguageDomain(socket);
      console.log(`Joining room ${roomId} - isFigLang detected: ${isFigLang}`);
      
      // 如果是figurativelanguage域名，确保使用figurative_language词库
      if (isFigLang && room.listName !== 'figurative_language') {
        console.log(`Updating room list name from ${room.listName} to figurative_language for figLang client`);
        room.listName = 'figurative_language';
        room.isFigLang = true;
      }
      
      room.players.push({ id: socket.id, name, role: null, alive: false, inPunishment: false });
      socket.join(roomId);
      // 修复：如果房主已不在房间，自动指定新房主
      if (!room.players.find(p => p.id === room.host)) {
        room.host = room.players[0].id;
      }
      room.id = roomId;
      console.log(`Player ${name} joined room ${roomId}, list name: ${room.listName}`);
      io.to(roomId).emit('room-updated', room);
    } else if (!room) {
      console.log(`Join room failed - Room ${roomId} not found`);
    } else {
      console.log(`Join room failed - Player already in room ${roomId}`);
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
    console.log(`Change-list event received - Room: ${roomId}, List: ${listName}`);
    const room = rooms[roomId];
    
    // 调试：打印所有房间信息
    console.log('Current rooms:', Object.keys(rooms).map(id => ({
      id,
      host: rooms[id].host,
      listName: rooms[id].listName,
      isFigLang: rooms[id].isFigLang,
      playerCount: rooms[id].players.length
    })));
    
    if (!room) {
      console.log(`Change list failed - Room ${roomId} not found`);
      return;
    }
    
    // 检查词库是否存在
    if (!wordLists[listName] || !Array.isArray(wordLists[listName]) || wordLists[listName].length === 0) {
      console.log(`Change list failed - List ${listName} not found or empty`);
      socket.emit('game-error', { message: `词库 ${listName} 不存在或为空，请选择其他词库。` });
      return;
    }
    
    console.log(`Changing list from ${room.listName} to ${listName}`);
    
    // 检查是否为特殊词库 - 只有在非figurativelanguage域名下才检查
    const isFigLang = isFigurativeLanguageDomain(socket);
    if (listName === 'figurative_language' && !isFigLang && !room.isFigLang) {
      console.log(`Allowing figurative_language list for figLang room`);
      // 不再发送错误消息，允许使用
    }
    
    // 强制更新房间词库
    room.listName = listName;
    console.log(`List changed successfully. Room now has listName: ${room.listName}`);
    
    // 确保更新已应用
    console.log(`Verification - Room ${roomId} now has listName: ${rooms[roomId].listName}`);
    
    // 向所有玩家广播房间更新
    io.to(roomId).emit('room-updated', room);
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
    room.players.forEach(p => { 
      p.role = null; 
      p.alive = false; 
      p.inPunishment = false; // 重置惩罚状态
    });
    room.status = 'waiting'; // 重置房间状态
    io.to(roomId).emit('room-updated', room);
  });

  // 开始游戏
  socket.on('start-game', ({ roomId, spyCount, isQuiz, quizId }) => {
    console.log(`Start-game event received - Room: ${roomId}, SpyCount: ${spyCount}, isQuiz: ${isQuiz}, quizId: ${quizId}`);
    const room = rooms[roomId];
    if (room) {
      // 检查客户端来源
      const isFigLang = isFigurativeLanguageDomain(socket);
      console.log(`Starting game in room ${roomId} - isFigLang detected: ${isFigLang}`);
      
      // 如果是figurativelanguage域名，强制使用figurative_language词库
      if (isFigLang) {
        console.log(`Forcing figurative_language list for figLang client in room ${roomId}`);
        room.listName = 'figurative_language';
        room.isFigLang = true;
      }
      
      console.log(`Starting game with list: ${room.listName}`);
      
      // 检查词库是否存在
      if (!wordLists[room.listName] || !Array.isArray(wordLists[room.listName]) || wordLists[room.listName].length === 0) {
        console.log(`Word list ${room.listName} not found or empty, cannot start game`);
        socket.emit('game-error', { message: `词库 ${room.listName} 不存在或为空，请选择其他词库或联系管理员。` });
        return;
      }
      
      // 记录开始前的词库信息
      console.log(`Pre-game word list check - Room: ${roomId}, List: ${room.listName}`);
      console.log(`Word list contains ${wordLists[room.listName].length} word pairs`);
      
      // 重置游戏状态
      room.gameStarted = true;
      room.votingStarted = false;
      room.players.forEach(p => {
        p.alive = true;
        p.role = null;
        p.inPunishment = false;
      });
      
      // 发牌
      dealWords(room, spyCount, isQuiz, quizId);
      
      // 记录发牌后的状态
      console.log(`Post-deal state - Room: ${roomId}, List used: ${room.listName}`);
      console.log(`Players with roles: ${room.players.filter(p => p.role !== null).length}/${room.players.length}`);
      
      io.to(roomId).emit('game-started', room);
    } else {
      console.log(`Start game failed - Room ${roomId} not found`);
    }
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
        
        // 标记平民进入惩罚环节 - 只在 figurativelanguage 域名中生效
        if (room.isFigLang) {
          alivePlayers.forEach(player => {
            if (player.role === 'civilian') {
              player.inPunishment = true;
              io.to(player.id).emit('enter-punishment');
            }
          });
        }
        
        io.to(roomId).emit('spy-win');
        io.to(roomId).emit('room-updated', room);
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
      
      // 标记卧底进入惩罚环节 - 只在 figurativelanguage 域名中生效
      if (room.isFigLang) {
        const spyPlayer = room.players.find(p => p.id === eliminatedId);
        if (spyPlayer) {
          spyPlayer.inPunishment = true;
          io.to(eliminatedId).emit('enter-punishment');
        }
      }
      
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-eliminated', { eliminatedId });
      io.to(roomId).emit('room-updated', room);
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
      
      // 标记平民进入惩罚环节 - 只在 figurativelanguage 域名中生效
      if (room.isFigLang) {
        alivePost.forEach(player => {
          if (player.role === 'civilian') {
            player.inPunishment = true;
            io.to(player.id).emit('enter-punishment');
          }
        });
      }
      
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-win');
      io.to(roomId).emit('room-updated', room);
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
      
      // 标记所有存活的平民进入惩罚环节 - 只在 figurativelanguage 域名中生效
      if (room.isFigLang) {
        room.players.forEach(player => {
          if (player.role === 'civilian' && !player.alive) {
            player.inPunishment = true;
            io.to(player.id).emit('enter-punishment');
          }
        });
      }
      
      io.to(roomId).emit('round-summary', { summary });
      io.to(roomId).emit('spy-win');
      io.to(roomId).emit('room-updated', room);
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

  // 处理惩罚环节完成 - 只在 figurativelanguage 域名中生效
  socket.on('punishment-completed', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.isFigLang) return;
    
    // 找到当前玩家
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.inPunishment = false;
      io.to(roomId).emit('room-updated', room);
    }
  });

  // 发牌函数
  function dealWords(room, spyCount, isQuiz, quizId) {
    console.log(`Dealing words for room ${room.id} - List: ${room.listName}, isFigLang: ${room.isFigLang}`);
    
    // 确保在 figurativelanguage 域名下使用 figurative_language 词库
    if (room.isFigLang && room.listName !== 'figurative_language') {
      console.log(`Correcting list name from ${room.listName} to figurative_language for figLang room`);
      room.listName = 'figurative_language';
    }
    
    // 选择词库
    const wordList = wordLists[room.listName];
    if (!wordList || !Array.isArray(wordList) || wordList.length === 0) {
      console.error(`Error: Word list ${room.listName} not found or empty`);
      
      // 通知房间中的所有玩家
      io.to(room.id).emit('game-error', { message: `词库 ${room.listName} 不存在或为空，请选择其他词库或联系管理员。` });
      return;
    }
    
    console.log(`Using word list: ${room.listName}, which has ${wordList.length} word pairs`);
    
    // 随机选择词语对
    const wordPairIndex = Math.floor(Math.random() * wordList.length);
    const wordPair = wordList[wordPairIndex];
    console.log(`Selected word pair index: ${wordPairIndex}, pair: ${wordPair}`);
    
    // 分割词语对
    let [cWord, sWord] = wordPair.split(',');
    
    // 确保词语对格式正确
    if (!sWord) {
      console.log(`Invalid word pair format: ${wordPair}, cannot start game`);
      io.to(room.id).emit('game-error', { message: `词库 ${room.listName} 中的词对格式不正确，请联系管理员。` });
      return;
    }
    
    // 特殊处理：对于figurative_language词库，不交换词语顺序
    if (room.listName === 'figurative_language') {
      console.log(`Using figurative_language list - Not swapping word order`);
    } else {
      // 随机交换词语顺序（普通词库）
      if (Math.random() > 0.5) {
        [cWord, sWord] = [sWord, cWord];
        console.log(`Swapped word order for non-figLang list`);
      }
    }
    
    console.log(`Final words assignment - Civilian: [${cWord}], Spy: [${sWord}]`);
    
    // 分配角色
    const playerCount = room.players.length;
    const spyIndices = new Set();
    
    // 随机选择间谍
    while (spyIndices.size < spyCount) {
      spyIndices.add(Math.floor(Math.random() * playerCount));
    }
    
    // 分配角色和词语
    room.players.forEach((player, index) => {
      player.role = spyIndices.has(index) ? 'spy' : 'civilian';
      player.alive = true;
    });
    
    // 记录词语分配
    wordMap[room.id] = {};
    room.players.forEach(p => {
      const word = p.role === 'spy' ? sWord : cWord;
      wordMap[room.id][p.id] = { word, role: p.role };
      io.to(p.id).emit('deal-words', { word, role: p.role });
      console.log(`Assigned word [${word}] to player ${p.name} (${p.role})`);
    });
  }
});

server.listen(3001, () => console.log('Listening on 3001'));