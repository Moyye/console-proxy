### 需要预先安装 node14+ 环境
#### windows 和 mac 推荐下载安装包直接安装 [中文官网地址](http://nodejs.cn/download/)

#### mac 和 linux 推荐使用进行安装nvm进行安装 [github首页](https://github.com/nvm-sh/nvm)
安装方法如下
```bash
$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
$ nvm install --lts
$ nvm alias default 14
```

### 安装依赖

```bash
$ npm install
```

### 配置(基本不需要修改即可运行)
- 方法一: 修改 .default.env 文件
- 方法二: 新增 .prod.env 文件覆盖变量
- 方法三: 直接添加环境变量, 如 PORT=4000

### 运行

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

### 后台运行
```bash
# 安装 pm2
$ npm i pm2 -g
# 后台启动
$ pm2 start dist/main.js --name console-proxy
# 后台关闭
$ pm2 delete console-proxy
# 查看程序
$ pm2 ls
# 查看日志
$ pm2 logs
# 保存服务自启动
$ pm2 startup
```

### Docker 运行
```
$ docker run -d --name console-proxy -p 3000:3000 selypan/console-proxy:1.0
```

## License

Nest is [MIT licensed](LICENSE).

[]: http://nodejs.cn/download/
