# 谁是卧底 & Fig Lang Game - 后端服务

这是"谁是卧底"和"Fig Lang Game"的后端服务，基于Node.js、Express和Socket.IO构建。

## 功能

- 房间管理
- 游戏逻辑处理
- 词库管理
- 惩罚环节题库
- 问答模式API支持
- 跨域资源共享(CORS)配置

## 安装与运行

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

## 部署

### 使用PM2部署

项目包含PM2配置文件，可以直接使用以下命令部署：

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

### Nginx配置

项目包含nginx.conf文件，可以用于配置Nginx反向代理：

```bash
sudo cp nginx.conf /etc/nginx/sites-available/spy-game
sudo ln -s /etc/nginx/sites-available/spy-game /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL配置

使用Let's Encrypt和Certbot配置SSL：

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d spyccb.top -d www.spyccb.top
sudo certbot --nginx -d figurativelanguage.spyccb.top
```

## API端点

### 词库管理

- `GET /wordlists` - 获取所有词库列表
- `POST /wordlists` - 创建新词库
- `DELETE /wordlists/:name` - 删除词库
- `GET /wordlists/:name` - 获取特定词库的词条
- `POST /wordlists/:name/items` - 添加词条
- `DELETE /wordlists/:name/items` - 删除词条

### 问答模式

- `GET /quiz/random` - 获取随机题目（仅限figurativelanguage子域名）
- `POST /quiz/submit` - 提交答案（仅限figurativelanguage子域名）

## 目录结构

- `server.js` - 主服务器文件
- `data/` - 包含游戏数据，如题库
- `data/quizzes.json` - 修辞手法题库
- `ecosystem.config.js` - PM2配置文件
- `nginx.conf` - Nginx配置文件
- `wordlists.json` - 词库数据

## 最近更新

- 添加问答模式API支持
- 改进CORS配置，支持更多端口和请求头
- 优化域名检测逻辑
- 增强日志记录，便于调试 