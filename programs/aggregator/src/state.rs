use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct Config {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}
