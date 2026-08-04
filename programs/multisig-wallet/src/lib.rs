use anchor_lang::prelude::*;

declare_id!("6kAdP7S1poZufGSxJ63LHr2KuLNjgmwNomjhu7WgAv8B");

#[program]
pub mod multisig_wallet {
    use super::*;

    pub fn initialize(ctx:Context<InitializeMultisig>,wallet_id:u64,owners:Vec<Pubkey>,threshold:u8)->Result<()>{

        if owners.len()==0{
            return Err(MultisigError::NoOwners.into());
        }
        if owners.len()> 10{
            return Err(MultisigError::TooManyOwners.into());
        }
        if threshold==0 || threshold as usize > owners.len(){
            return Err(MultisigError::InvalidThreshold.into());
        }
        for (i,_) in owners.iter().enumerate(){
            for j in i+1..owners.len(){
                if owners[i]==owners[j]{
                    return Err(MultisigError::DuplicateOwners.into());
                }
            }

        }
        ctx.accounts.multisig.owners=owners;
        ctx.accounts.multisig.threshold=threshold;
        ctx.accounts.multisig.proposal_count=0;
        ctx.accounts.multisig.wallet_id=wallet_id;
        Ok(())
    }

    
}

#[derive(Accounts)]
#[instruction(wallet_id:u64)]
pub struct InitializeMultisig<'info> {
    #[account(mut)]
    pub initializer:Signer<'info>,

    #[account(
        init,
        payer=initializer,
        space=8+Multisig::INIT_SPACE,
        seeds=[b"multisig",initializer.key().as_ref(),wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    pub system_program:Program<'info,System>

}

#[account]
#[derive(InitSpace)]
pub struct Multisig {
    pub wallet_id:u64,
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

#[error_code]
pub enum MultisigError{
    #[msg("The multisig must have at least one owner")]
    NoOwners,
    #[msg("The multisig cannot have more than 10 owners")]
    TooManyOwners,
    #[msg("The threshold must be at least 1 and less than or equal to the number of owners")]
    InvalidThreshold,
    #[msg("Duplicate owners are not allowed")]
    DuplicateOwners,
}