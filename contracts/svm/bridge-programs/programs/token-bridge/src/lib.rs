use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_lang::solana_program;

declare_id!("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");

pub mod state;
pub mod error;

use state::*;
use error::*;

#[program]
pub mod token_bridge {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        config.authority = authority;
        config.exchange_enabled = true;
        config.default_fee_bps = 0;
        config.fee_recipient = authority;
        config.paused = false;
        Ok(())
    }

    pub fn initialize_custody(_ctx: Context<InitializeCustody>) -> Result<()> {
        Ok(())
    }

    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
        target_chain: u16,
        target_token: [u8; 32],
        recipient: [u8; 32],
    ) -> Result<()> {
        let binding = &ctx.accounts.token_binding;
        require!(binding.enabled, TokenBridgeError::TokenBindingNotEnabled);

        // Lock tokens to custody
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

        // Calculate target amount based on exchange rate
        let target_amount = amount
            .checked_mul(binding.rate_numerator)
            .and_then(|v| v.checked_div(binding.rate_denominator))
            .ok_or(TokenBridgeError::InvalidExchangeRate)?;

        // Construct TokenTransfer payload (133 bytes total)
        // Layout per API spec section 3.2
        let mut payload = Vec::with_capacity(133);
        payload.push(1); // payload_type (1 byte), offset 0
        payload.extend_from_slice(&amount.to_be_bytes()); // amount (8 bytes), offset 1-8
        payload.extend_from_slice(&ctx.accounts.token_mint.key().to_bytes()); // token_address (32 bytes), offset 9-40
        payload.extend_from_slice(&900u16.to_be_bytes()); // token_chain (2 bytes), offset 41-42
        payload.extend_from_slice(&recipient); // recipient (32 bytes), offset 43-74
        payload.extend_from_slice(&target_chain.to_be_bytes()); // recipient_chain (2 bytes), offset 75-76
        payload.extend_from_slice(&target_token); // target_token (32 bytes), offset 77-108
        payload.extend_from_slice(&target_amount.to_be_bytes()); // target_amount (8 bytes), offset 109-116
        payload.extend_from_slice(&binding.rate_numerator.to_be_bytes()); // exchange_rate_num (8 bytes), offset 117-124
        payload.extend_from_slice(&binding.rate_denominator.to_be_bytes()); // exchange_rate_denom (8 bytes), offset 125-132

        // Call solana-core.post_message via CPI
        let nonce = Clock::get()?.unix_timestamp as u32;
        let consistency_level = 15; // Safe confirmation
        
        let cpi_program = ctx.accounts.core_program.to_account_info();
        let cpi_accounts = solana_core::cpi::accounts::PostMessage {
            bridge: ctx.accounts.bridge.to_account_info(),
            message: ctx.accounts.message.to_account_info(),
            emitter: ctx.accounts.emitter.to_account_info(), // token-bridge program as emitter
            sequence: ctx.accounts.sequence.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        solana_core::cpi::post_message(
            cpi_ctx,
            nonce,
            payload,
            consistency_level
        )?;

        Ok(())
    }

    pub fn complete_transfer(
        ctx: Context<CompleteTransfer>,
    ) -> Result<()> {
        let binding = &ctx.accounts.token_binding;
        require!(binding.enabled, TokenBridgeError::TokenBindingNotEnabled);

        let posted_vaa = &mut ctx.accounts.posted_vaa;
        require!(!posted_vaa.consumed, TokenBridgeError::VAAAlreadyConsumed);

        // Validate payload format (157 bytes for new format with exchange)
        require!(
            posted_vaa.payload.len() >= 157,
            TokenBridgeError::InvalidPayload
        );

        // Parse recipient_chain (offset 99-100)
        let recipient_chain = u16::from_be_bytes([posted_vaa.payload[99], posted_vaa.payload[100]]);
        require!(
            recipient_chain == 900,
            TokenBridgeError::InvalidTargetChain
        );

        // Validate target token matches binding (offset 101-132)
        let payload_target_token: [u8; 32] = posted_vaa.payload[101..133].try_into().unwrap();
        require!(
            payload_target_token == binding.target_token,
            TokenBridgeError::TargetTokenMismatch
        );

        // Parse target_amount (offset 133-140)
        let target_amount_bytes: [u8; 8] = posted_vaa.payload[133..141].try_into().unwrap();
        let transfer_amount = u64::from_be_bytes(target_amount_bytes);

        // Validate exchange rate matches binding (offset 141-148 and 149-156)
        let payload_rate_num_bytes: [u8; 8] = posted_vaa.payload[141..149].try_into().unwrap();
        let payload_rate_denom_bytes: [u8; 8] = posted_vaa.payload[149..157].try_into().unwrap();
        let payload_rate_num = u64::from_be_bytes(payload_rate_num_bytes);
        let payload_rate_denom = u64::from_be_bytes(payload_rate_denom_bytes);

        require!(
            payload_rate_num == binding.rate_numerator && payload_rate_denom == binding.rate_denominator,
            TokenBridgeError::InvalidExchangeRate
        );

        let mint_key = ctx.accounts.target_token_mint.key();
        let custody_bump = ctx.bumps.custody_account;
        let seeds = &[
            b"Custody".as_ref(),
            mint_key.as_ref(),
            &[custody_bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.custody_account.to_account_info(),
                    to: ctx.accounts.recipient_account.to_account_info(),
                    authority: ctx.accounts.custody_account.to_account_info(),
                },
                signer,
            ),
            transfer_amount,
        )?;

        posted_vaa.consumed = true;

        Ok(())
    }

    pub fn register_token_binding(
        ctx: Context<RegisterTokenBinding>,
        source_chain: u16,
        source_token: [u8; 32],
        target_chain: u16,
        target_token: [u8; 32],
    ) -> Result<()> {
        let binding = &mut ctx.accounts.token_binding;
        binding.source_chain = source_chain;
        binding.source_token = source_token;
        binding.target_chain = target_chain;
        binding.target_token = target_token;
        binding.rate_numerator = 1;
        binding.rate_denominator = 1;
        binding.use_external_price = false;
        binding.amm_program_id = Pubkey::default();
        binding.enabled = true;
        binding.created_at = Clock::get()?.unix_timestamp;
        binding.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

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
        outbound.created_at = Clock::get()?.unix_timestamp;
        outbound.updated_at = Clock::get()?.unix_timestamp;

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
        inbound.created_at = Clock::get()?.unix_timestamp;
        inbound.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn set_exchange_rate(
        ctx: Context<SetExchangeRate>,
        _source_chain: u16,
        _source_token: [u8; 32],
        _target_chain: u16,
        _target_token: [u8; 32],
        rate_numerator: u64,
        rate_denominator: u64,
    ) -> Result<()> {
        require!(rate_denominator != 0, TokenBridgeError::ZeroDenominator);

        let binding = &mut ctx.accounts.token_binding;
        binding.rate_numerator = rate_numerator;
        binding.rate_denominator = rate_denominator;
        binding.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn update_amm_config(
        ctx: Context<UpdateAmmConfig>,
        _source_chain: u16,
        _source_token: [u8; 32],
        _target_chain: u16,
        _target_token: [u8; 32],
        amm_program_id: Pubkey,
        use_external_price: bool,
    ) -> Result<()> {
        let binding = &mut ctx.accounts.token_binding;
        binding.amm_program_id = amm_program_id;
        binding.use_external_price = use_external_price;
        binding.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn set_token_binding_enabled(
        ctx: Context<SetTokenBindingEnabled>,
        _source_chain: u16,
        _source_token: [u8; 32],
        _target_chain: u16,
        _target_token: [u8; 32],
        enabled: bool,
    ) -> Result<()> {
        let binding = &mut ctx.accounts.token_binding;
        binding.enabled = enabled;
        binding.updated_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + BridgeConfig::LEN,
        seeds = [b"BridgeConfig"],
        bump
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeCustody<'info> {
    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = custody,
        seeds = [b"Custody", mint.key().as_ref()],
        bump
    )]
    pub custody: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, target_chain: u16, target_token: [u8; 32])]
pub struct TransferTokens<'info> {
    /// CHECK: solana-core program
    #[account(executable, address = solana_core::ID)]
    pub core_program: AccountInfo<'info>,

    /// CHECK: Bridge account from solana-core program
    pub bridge: AccountInfo<'info>,

    #[account(
        seeds = [
            b"TokenBinding",
            &900u16.to_le_bytes(),
            token_mint.key().as_ref(),
            &target_chain.to_le_bytes(),
            &target_token,
        ],
        bump
    )]
    pub token_binding: Account<'info, TokenBinding>,

    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub custody_account: Account<'info, TokenAccount>,

    pub token_authority: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    /// CHECK: Message account to be created in solana-core
    #[account(mut)]
    pub message: Signer<'info>,

    /// CHECK: Token-bridge program itself, used as emitter for CPI
    #[account(executable, address = crate::ID)]
    pub emitter: AccountInfo<'info>,

    /// CHECK: Sequence account from solana-core program (derived from emitter)
    #[account(mut)]
    pub sequence: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteTransfer<'info> {
    /// CHECK: Bridge account from solana-core program
    pub bridge: AccountInfo<'info>,

    #[account(mut)]
    pub posted_vaa: Account<'info, solana_core::state::PostedVAA>,

    pub token_binding: Account<'info, TokenBinding>,

    #[account(mut)]
    pub recipient_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"Custody", target_token_mint.key().as_ref()],
        bump
    )]
    pub custody_account: Account<'info, TokenAccount>,

    pub target_token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct RegisterTokenBinding<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump,
        has_one = authority
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + TokenBinding::LEN,
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
#[instruction(local_chain: u16, local_token: [u8; 32], remote_chain: u16, remote_token: [u8; 32])]
pub struct RegisterBidirectionalBinding<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump,
        has_one = authority
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        init,
        payer = payer,
        space = 8 + TokenBinding::LEN,
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

    #[account(
        init,
        payer = payer,
        space = 8 + TokenBinding::LEN,
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
        bump,
        has_one = authority
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
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct UpdateAmmConfig<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump,
        has_one = authority
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
#[instruction(source_chain: u16, source_token: [u8; 32], target_chain: u16, target_token: [u8; 32])]
pub struct SetTokenBindingEnabled<'info> {
    #[account(
        seeds = [b"BridgeConfig"],
        bump,
        has_one = authority
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

