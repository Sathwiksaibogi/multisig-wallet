use anchor_lang::prelude::*;

declare_id!("6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B");

#[program]
pub mod multisig_wallet {
    use super::*;

    
}

#[derive(Accounts)]
pub struct Initialize {}

#[account]
#[derive(InitSpace)]
pub struct Multisig {
    #[max_len(10)]
    pub owners: Vec<Pubkey>,
    pub threshold:u8,
    pub proposal_count:u64
}   

#[account]
#[derive(InitSpace)]
pub struct Proposal{
    pub wallet:Pubkey,
    pub creator:Pubkey,
    pub recipient:Pubkey,
    pub amount:u64,
    #[max_len(10)]
    pub approvals:Vec<Pubkey>,
    pub executed:bool
}