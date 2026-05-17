# 统一封装与交付规划

## 目标
项目完成后，统一收拢到一个清晰的交付目录，便于：
- 本地运行
- Docker 部署
- 后续接真实交易所
- 打包归档

## 推荐封装目录
quant-gate-mvp/
- apps/
  - api/
  - web/
- packages/
  - shared/
- infra/
- docs/
- scripts/
- .env.example
- README.md
- start-dev.(sh|ps1)
- start-prod.(sh|ps1)

## 后续整理动作
### 1. scripts/
增加统一脚本：
- 启动后端
- 启动前端
- 启动 docker-compose
- 运行回测 demo

### 2. 根目录统一入口
增加：
- `start-dev.ps1`
- `start-prod.ps1`
- `Makefile` 或 npm workspace（后续可选）

### 3. 配置集中化
- API 地址
- 默认交易对
- 默认周期
- 默认杠杆
- 风控参数
统一抽到配置文件/环境变量

### 4. 打包交付
后期可把整个 `quant-gate-mvp/` 作为一个完整交付文件夹，内部自洽。

## 当前状态
- 已按 monorepo 风格建好主目录
- 后续只需继续往这个目录补齐即可
