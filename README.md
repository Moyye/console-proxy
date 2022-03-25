

### 配置地址
- 格式为 http://IP:PORT
- 例如部署在本地的就是 http://127.0.0.1:3000 （http协议，不是https协议哦）

### 方法一(建议)：Docker 运行
```
# 若未安装 docker，可以一键安装 docker 环境后执行上面的安装命令
$ curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun

# 已经安装了 docker 的服务器直接执行下面的安装命令
$ docker pull selypan/console-proxy:latest
$ docker run -d -p 3000:3000 --name console-proxy selypan/console-proxy:latest

安装完成后，地址为服务器公网IP（局域网IP），端口为3000，例如 http://127.0.0.1:3000
```

一键安装，适合没有安装过 docker 的 linux 主机
```shell
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun && docker pull selypan/console-proxy:latest && docker run -d -p 3000:3000 --name console-proxy selypan/console-proxy:latest
```


### 方法二(需要一定Node.js基础)：需要预先安装 node14+ 环境
#### windows 和 mac 推荐下载安装包直接安装 [中文官网地址](http://nodejs.cn/download/)

#### mac 和 linux 推荐使用进行安装nvm进行安装 [github首页](https://github.com/nvm-sh/nvm)
安装方法如下
```bash
$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
# 有时候 raw.githubusercontent.com 被污染,无法访问,可以使用下面个人的 cdn 版本
# curl -o- https://console-hz.selypan.com/assert/install.sh | bash

$ 
$ nvm install --lts
$ nvm alias default 14
```

### 安装依赖

```bash
$ cd console-proxy
$ npm install
# npm install 如果速度慢可以使用淘宝镜像 
# npm config set registry https://registry.npm.taobao.org
```

### 环境变量配置(基本不需要修改即可运行)
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
$ npm run build 
$ pm2 start dist/main.js --name console-proxy

# 后台关闭
$ pm2 delete console-proxy

# 查看程序
$ pm2 ls

# 查看日志
$ pm2 logs

# 保存服务自启动
$ pm2 startup

# 停止 pm2 (不建议,pm2 后台运行几乎没有消耗)
$ pm2 kill
```

## License

[MIT licensed](LICENSE).
