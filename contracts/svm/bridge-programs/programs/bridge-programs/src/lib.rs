use anchor_lang::prelude::*;

declare_id!("6M3PpQvV5zHdqgM4vKNvnqn8PTNn7xwzKstVAH1r4dik");

#[program]
pub mod bridge_programs {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
