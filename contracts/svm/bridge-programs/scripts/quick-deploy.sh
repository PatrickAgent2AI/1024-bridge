#!/bin/bash

# Solana Bridge 一键部署脚本
# 用于快速部署到Devnet或自定义测试网

set -e

echo "============================================================"
echo "Solana Bridge 一键部署脚本"
echo "============================================================"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查参数
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo ""
    echo "用法:"
    echo "  ./scripts/quick-deploy.sh [NETWORK]"
    echo ""
    echo "参数:"
    echo "  NETWORK    网络类型 (devnet | testnet | custom)"
    echo ""
    echo "示例:"
    echo "  ./scripts/quick-deploy.sh devnet"
    echo "  ./scripts/quick-deploy.sh custom"
    echo ""
    echo "环境变量 (custom网络时需要):"
    echo "  CUSTOM_RPC_URL    自定义RPC地址"
    echo "  WALLET_PATH       钱包路径 (可选)"
    echo ""
    exit 0
fi

NETWORK=${1:-devnet}

echo ""
echo "目标网络: $NETWORK"

# 设置RPC URL
case $NETWORK in
    devnet)
        RPC_URL="https://api.devnet.solana.com"
        ;;
    testnet)
        RPC_URL="https://api.testnet.solana.com"
        ;;
    custom)
        if [ -z "$CUSTOM_RPC_URL" ]; then
            echo -e "${RED}❌ 错误: 自定义网络需要设置 CUSTOM_RPC_URL 环境变量${NC}"
            echo ""
            echo "示例:"
            echo "  export CUSTOM_RPC_URL=https://your-custom-rpc.com"
            echo "  ./scripts/quick-deploy.sh custom"
            exit 1
        fi
        RPC_URL=$CUSTOM_RPC_URL
        ;;
    *)
        echo -e "${RED}❌ 未知网络: $NETWORK${NC}"
        echo "支持的网络: devnet, testnet, custom"
        exit 1
        ;;
esac

echo "RPC URL: $RPC_URL"

# 设置钱包
WALLET_PATH=${WALLET_PATH:-~/.config/solana/id.json}
echo "钱包路径: $WALLET_PATH"

if [ ! -f "$WALLET_PATH" ]; then
    echo -e "${RED}❌ 钱包文件不存在: $WALLET_PATH${NC}"
    echo "请先创建钱包: solana-keygen new --outfile $WALLET_PATH"
    exit 1
fi

# 导出环境变量
export ANCHOR_PROVIDER_URL=$RPC_URL
export ANCHOR_WALLET=$WALLET_PATH

echo ""
echo "============================================================"
echo "步骤1: 环境检查"
echo "============================================================"

# 检查Solana CLI
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Solana CLI:${NC} $(solana --version)"

# 检查Anchor CLI
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor CLI未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Anchor CLI:${NC} $(anchor --version)"

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js:${NC} $(node --version)"

# 配置Solana CLI
echo ""
echo "⏳ 配置Solana CLI..."
solana config set --url $RPC_URL > /dev/null

# 检查余额
echo ""
echo "⏳ 检查钱包余额..."
WALLET_ADDRESS=$(solana address)
echo "  钱包地址: $WALLET_ADDRESS"

BALANCE=$(solana balance | awk '{print $1}')
echo "  当前余额: $BALANCE SOL"

if (( $(echo "$BALANCE < 1" | bc -l) )); then
    echo -e "${YELLOW}⚠️  余额不足1 SOL，建议至少2 SOL${NC}"
    
    if [ "$NETWORK" == "devnet" ] || [ "$NETWORK" == "testnet" ]; then
        echo "  正在尝试空投..."
        solana airdrop 2 || echo -e "${YELLOW}空投失败，请手动空投${NC}"
    else
        echo "  请联系测试网管理员空投SOL"
        exit 1
    fi
fi

echo ""
echo "============================================================"
echo "步骤2: 编译程序"
echo "============================================================"

echo "⏳ 清理缓存..."
anchor clean

echo "⏳ 编译程序..."
anchor build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 编译成功${NC}"
else
    echo -e "${RED}❌ 编译失败${NC}"
    exit 1
fi

echo ""
echo "============================================================"
echo "步骤3: 部署程序"
echo "============================================================"

echo "⏳ 部署到 $NETWORK..."
anchor deploy --provider.cluster $RPC_URL --provider.wallet $WALLET_PATH

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 部署成功${NC}"
else
    echo -e "${RED}❌ 部署失败${NC}"
    exit 1
fi

# 显示Program ID
echo ""
echo "已部署的Program ID:"
anchor keys list

echo ""
echo "============================================================"
echo "步骤4: 初始化合约"
echo "============================================================"

echo "⏳ 运行初始化脚本..."
yarn testnet:init

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 初始化成功${NC}"
else
    echo -e "${RED}❌ 初始化失败${NC}"
    exit 1
fi

echo ""
echo "============================================================"
echo "步骤5: 验证部署"
echo "============================================================"

echo "⏳ 运行验证脚本..."
yarn testnet:verify

echo ""
echo "============================================================"
echo "🎉 部署完成！"
echo "============================================================"

echo ""
echo "部署信息:"
echo "  网络: $NETWORK"
echo "  RPC: $RPC_URL"
echo "  钱包: $WALLET_ADDRESS"

echo ""
echo "下一步:"
echo "  1. 注册代币映射: yarn testnet:register"
echo "  2. 运行测试: yarn testnet:test"
echo "  3. 查看文档: cat DEPLOYMENT.md"
echo ""


