use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

declare_id!("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");

pub mod state;
pub mod error;

use state::*;

#[program]
pub mod token_bridge {
    use super::*;

    /// 锁定SPL代币并发起跨链转账
    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
        _target_chain: u16,
        _recipient: [u8; 32],
    ) -> Result<()> {
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
        
        // 2. 构造TokenTransfer payload
        let mut payload = Vec::new();
        payload.push(1u8); // payloadType
        
        // TODO: 调用solana-core.post_message发送跨链消息
        
        msg!("Tokens transferred: amount={}", amount);
        
        Ok(())
    }

    /// 完成跨链转账（解锁或铸造）
    pub fn complete_transfer(
        _ctx: Context<CompleteTransfer>,
        _vaa: Vec<u8>,
    ) -> Result<()> {
        // TODO: 验证VAA，解析payload，解锁或铸造代币
        
        msg!("Transfer completed");
        
        Ok(())
    }

    /// 创建包装SPL代币
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

// ============================================
// 账户验证结构
// ============================================

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    /// CHECK: Token account checked by token program
    #[account(mut)]
    pub token_account: AccountInfo<'info>,
    
    /// CHECK: Custody account checked by token program
    #[account(mut)]
    pub custody_account: AccountInfo<'info>,
    
    pub token_authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CompleteTransfer<'info> {
    /// CHECK: Recipient account checked by token program
    #[account(mut)]
    pub recipient_account: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
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

