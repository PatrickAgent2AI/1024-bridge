use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

declare_id!("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");

pub mod state;
pub mod error;

use state::*;
use error::TokenBridgeError;

// ============================================
// 账户验证结构（必须在#[program]之前定义）
// ============================================

#[derive(Accounts)]
pub struct InitializeBridgeConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = BridgeConfig::LEN,
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct RegisterTokenBinding<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            source_chain.to_le_bytes().as_ref(),
            source_token.as_ref(),
            target_chain.to_le_bytes().as_ref(),
            target_token.as_ref(),
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    local_chain: u16,
    local_token: [u8; 32],
    remote_chain: u16,
    remote_token: [u8; 32]
)]
pub struct RegisterBidirectionalBinding<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    // 出站binding
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            local_chain.to_le_bytes().as_ref(),
            local_token.as_ref(),
            remote_chain.to_le_bytes().as_ref(),
            remote_token.as_ref(),
        ],
        bump
    )]
    pub outbound_binding: Account<'info, TokenBinding>,
    
    // 入站binding
    #[account(
        init,
        payer = payer,
        space = TokenBinding::LEN,
        seeds = [
            b"TokenBinding",
            remote_chain.to_le_bytes().as_ref(),
            remote_token.as_ref(),
            local_chain.to_le_bytes().as_ref(),
            local_token.as_ref(),
        ],
        bump
    )]
    pub inbound_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct SetExchangeRate<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    #[account(
        mut,
        seeds = [
            b"TokenBinding",
            source_chain.to_le_bytes().as_ref(),
            source_token.as_ref(),
            target_chain.to_le_bytes().as_ref(),
            target_token.as_ref(),
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, target_chain: u16, target_token: [u8; 32])]
pub struct TransferTokens<'info> {
    #[account(
        seeds = [b"TokenBinding",
            900u16.to_le_bytes().as_ref(),
            token_mint.key().as_ref(),
            target_chain.to_le_bytes().as_ref(),
            target_token.as_ref(),
        ],
        bump,
        constraint = token_binding.enabled @ TokenBridgeError::TokenBindingNotEnabled
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,
    
    pub token_authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CompleteTransfer<'info> {
    #[account(mut)]
    pub recipient_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct UpdateAmmConfig<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,
    
    #[account(
        mut,
        seeds = [
            b"TokenBinding",
            source_chain.to_le_bytes().as_ref(),
            source_token.as_ref(),
            target_chain.to_le_bytes().as_ref(),
            target_token.as_ref(),
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(chain: u16, token_address: [u8; 32])]
pub struct CreateWrapped<'info> {
    #[account(
        init,
        payer = payer,
        space = WrappedMeta::LEN,
        seeds = [b"WrappedMeta", chain.to_le_bytes().as_ref(), token_address.as_ref()],
        bump
    )]
    pub wrapped_meta: Account<'info, WrappedMeta>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[program]
pub mod token_bridge {
    use super::*;

    /// 初始化BridgeConfig
    pub fn initialize_bridge_config(
        ctx: Context<InitializeBridgeConfig>,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        let bridge_config = &mut ctx.accounts.bridge_config;
        bridge_config.authority = ctx.accounts.authority.key();
        bridge_config.exchange_enabled = true;
        bridge_config.default_fee_bps = 0;
        bridge_config.fee_recipient = fee_recipient;
        bridge_config.paused = false;
        
        msg!("Bridge config initialized with authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// 注册单向代币绑定
    pub fn register_token_binding(
        ctx: Context<RegisterTokenBinding>,
        source_chain: u16,
        source_token: [u8; 32],
        target_chain: u16,
        target_token: [u8; 32],
    ) -> Result<()> {
        // 验证权限
        require!(
            ctx.accounts.authority.key() == ctx.accounts.bridge_config.authority,
            TokenBridgeError::Unauthorized
        );
        
        let token_binding = &mut ctx.accounts.token_binding;
        let clock = Clock::get()?;
        
        token_binding.source_chain = source_chain;
        token_binding.source_token = source_token;
        token_binding.target_chain = target_chain;
        token_binding.target_token = target_token;
        token_binding.rate_numerator = 1;
        token_binding.rate_denominator = 1;
        token_binding.use_external_price = false;
        token_binding.amm_program_id = Pubkey::default();
        token_binding.enabled = true;
        token_binding.created_at = clock.unix_timestamp;
        token_binding.updated_at = clock.unix_timestamp;
        
        msg!("Token binding registered: {}:{:?} -> {}:{:?}",
            source_chain, &source_token[28..32],
            target_chain, &target_token[28..32]
        );
        
        Ok(())
    }

    /// 注册双向代币绑定
    pub fn register_bidirectional_binding(
        ctx: Context<RegisterBidirectionalBinding>,
        local_chain: u16,
        local_token: [u8; 32],
        remote_chain: u16,
        remote_token: [u8; 32],
        outbound_rate_num: u64,
        outbound_rate_denom: u64,
        inbound_rate_num: u64,
        inbound_rate_denom: u64,
    ) -> Result<()> {
        // 验证权限
        require!(
            ctx.accounts.authority.key() == ctx.accounts.bridge_config.authority,
            TokenBridgeError::Unauthorized
        );
        
        // 验证兑换比率
        require!(
            outbound_rate_denom != 0 && inbound_rate_denom != 0,
            TokenBridgeError::ZeroDenominator
        );
        
        let clock = Clock::get()?;
        
        // 初始化出站binding
        let outbound = &mut ctx.accounts.outbound_binding;
        outbound.source_chain = local_chain;
        outbound.source_token = local_token;
        outbound.target_chain = remote_chain;
        outbound.target_token = remote_token;
        outbound.rate_numerator = outbound_rate_num;
        outbound.rate_denominator = outbound_rate_denom;
        outbound.use_external_price = false;
        outbound.amm_program_id = Pubkey::default();
        outbound.enabled = true;
        outbound.created_at = clock.unix_timestamp;
        outbound.updated_at = clock.unix_timestamp;
        
        // 初始化入站binding
        let inbound = &mut ctx.accounts.inbound_binding;
        inbound.source_chain = remote_chain;
        inbound.source_token = remote_token;
        inbound.target_chain = local_chain;
        inbound.target_token = local_token;
        inbound.rate_numerator = inbound_rate_num;
        inbound.rate_denominator = inbound_rate_denom;
        inbound.use_external_price = false;
        inbound.amm_program_id = Pubkey::default();
        inbound.enabled = true;
        inbound.created_at = clock.unix_timestamp;
        inbound.updated_at = clock.unix_timestamp;
        
        msg!("Bidirectional binding registered: {}:{:?} <-> {}:{:?}",
            local_chain, &local_token[28..32],
            remote_chain, &remote_token[28..32]
        );
        
        Ok(())
    }

    /// 设置兑换比率
    pub fn set_exchange_rate(
        ctx: Context<SetExchangeRate>,
        _source_chain: u16,
        _source_token: [u8; 32],
        _target_chain: u16,
        _target_token: [u8; 32],
        rate_numerator: u64,
        rate_denominator: u64,
    ) -> Result<()> {
        // 验证权限
        require!(
            ctx.accounts.authority.key() == ctx.accounts.bridge_config.authority,
            TokenBridgeError::Unauthorized
        );
        
        // 验证兑换比率
        require!(
            rate_denominator != 0,
            TokenBridgeError::ZeroDenominator
        );
        
        let token_binding = &mut ctx.accounts.token_binding;
        token_binding.rate_numerator = rate_numerator;
        token_binding.rate_denominator = rate_denominator;
        token_binding.updated_at = Clock::get()?.unix_timestamp;
        
        msg!("Exchange rate updated: {}:{}", rate_numerator, rate_denominator);
        
        Ok(())
    }

    /// 锁定SPL代币并发起跨链转账
    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
        target_chain: u16,
        target_token: [u8; 32],
        recipient: [u8; 32],
    ) -> Result<()> {
        let token_binding = &ctx.accounts.token_binding;
        
        // 验证TokenBinding启用
        require!(
            token_binding.enabled,
            TokenBridgeError::TokenBindingNotEnabled
        );
        
        // 1. 转账SPL代币到custody账户
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_account.to_account_info(),
                    to: ctx.accounts.custody_account.to_account_info(),
                    authority: ctx.accounts.token_authority.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // 2. 计算目标链代币数量（应用兑换比率）
        let target_amount = if token_binding.use_external_price {
            // TODO: 调用外部AMM获取价格（预留）
            amount
        } else {
            // 使用固定比率
            amount.checked_mul(token_binding.rate_numerator)
                .unwrap()
                .checked_div(token_binding.rate_denominator)
                .unwrap()
        };
        
        // 3. 构造TokenTransfer payload（包含兑换信息）
        // Payload格式见API-SPEC.md: 133字节
        let mut payload = Vec::with_capacity(133);
        
        // 基础字段
        payload.push(1u8); // payload_type
        payload.extend_from_slice(&amount.to_be_bytes()); // amount (8 bytes)
        payload.extend_from_slice(&ctx.accounts.token_mint.key().to_bytes()); // token_address (32 bytes)
        payload.extend_from_slice(&900u16.to_be_bytes()); // token_chain: Solana=900 (2 bytes)
        payload.extend_from_slice(&recipient); // recipient (32 bytes)
        payload.extend_from_slice(&target_chain.to_be_bytes()); // recipient_chain (2 bytes)
        
        // 新增兑换字段
        payload.extend_from_slice(&target_token); // target_token (32 bytes)
        payload.extend_from_slice(&target_amount.to_be_bytes()); // target_amount (8 bytes)
        payload.extend_from_slice(&token_binding.rate_numerator.to_be_bytes()); // exchange_rate_num (8 bytes)
        payload.extend_from_slice(&token_binding.rate_denominator.to_be_bytes()); // exchange_rate_denom (8 bytes)
        
        // 4. TODO: 调用solana-core的post_message发送跨链消息
        // 这需要CPI调用，暂时记录日志
        msg!("TokensTransferred: amount={}, target_chain={}, target_amount={}, payload_len={}",
            amount, target_chain, target_amount, payload.len()
        );
        
        Ok(())
    }

    /// 完成跨链转账（解锁代币）
    pub fn complete_transfer(
        ctx: Context<CompleteTransfer>,
        vaa: Vec<u8>,
    ) -> Result<()> {
        // TODO: 完整实现
        // 1. 验证VAA（调用solana-core.post_vaa）
        // 2. 解析TokenTransfer payload
        // 3. 检查目标链 = Solana（chain_id=900）
        // 4. 验证TokenBinding配置和兑换比率
        // 5. 从custody解锁目标代币到接收者
        // 6. 标记VAA已消费
        
        msg!("Transfer completed, VAA size: {}", vaa.len());
        
        Ok(())
    }

    /// 更新AMM配置（预留接口）
    pub fn update_amm_config(
        ctx: Context<UpdateAmmConfig>,
        _source_chain: u16,
        _source_token: [u8; 32],
        _target_chain: u16,
        _target_token: [u8; 32],
        amm_program_id: Pubkey,
        use_external_price: bool,
    ) -> Result<()> {
        // 验证权限
        require!(
            ctx.accounts.authority.key() == ctx.accounts.bridge_config.authority,
            TokenBridgeError::Unauthorized
        );
        
        let token_binding = &mut ctx.accounts.token_binding;
        token_binding.amm_program_id = amm_program_id;
        token_binding.use_external_price = use_external_price;
        token_binding.updated_at = Clock::get()?.unix_timestamp;
        
        msg!("AMM config updated: use_external_price={}", use_external_price);
        
        Ok(())
    }

    /// 创建包装SPL代币（已弃用，保留以兼容旧测试）
    pub fn create_wrapped(
        ctx: Context<CreateWrapped>,
        chain: u16,
        token_address: [u8; 32],
        decimals: u8,
    ) -> Result<()> {
        let wrapped_meta = &mut ctx.accounts.wrapped_meta;
        wrapped_meta.original_chain = chain;
        wrapped_meta.original_address = token_address;
        wrapped_meta.decimals = decimals;
        
        msg!("Wrapped token created for chain={}, decimals={}", chain, decimals);
        
        Ok(())
    }
}
