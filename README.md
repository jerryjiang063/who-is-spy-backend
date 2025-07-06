# 谁是卧底 & Fig Lang Game - 后端服务

这是"谁是卧底"和"Fig Lang Game"的后端服务，基于Node.js、Express和Socket.IO构建。

## 功能

- 房间管理
- 游戏逻辑处理
- 词库管理
- 惩罚环节题库

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

## 目录结构

- `server.js` - 主服务器文件
- `data/` - 包含游戏数据，如题库
- `ecosystem.config.js` - PM2配置文件
- `nginx.conf` - Nginx配置文件 