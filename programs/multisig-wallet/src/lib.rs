use anchor_lang::system_program;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};


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
        ctx.accounts.multisig.initializer=ctx.accounts.initializer.key();
        ctx.accounts.multisig.owners=owners;
        ctx.accounts.multisig.threshold=threshold;
        ctx.accounts.multisig.proposal_count=0;
        ctx.accounts.multisig.wallet_id=wallet_id;
        Ok(())
    }

    pub fn initialize_vault(_ctx:Context<InitializeVault>)->Result<()>{
        Ok(())
    }

    pub fn initialize_token_vault(_ctx:Context<InitializeTokenVault>)->Result<()>{
        Ok(())
    }

    pub fn deposit(ctx:Context<Deposit>,amount:u64)->Result<()>{
        if amount==0{
            return Err(MultisigError::InvalidAmount.into());
        }
        let transfer_instruction=system_program::Transfer{
            from:ctx.accounts.depositor.to_account_info(),
            to:ctx.accounts.vault.to_account_info(),
        };
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                transfer_instruction
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn deposit_token(ctx:Context<DepositToken>,amount:u64)->Result<()>{
        if amount==0{
            return Err(MultisigError::InvalidAmount.into());
        }
        let token_transfer_instruction=anchor_spl::token::Transfer{
            from:ctx.accounts.depositor_token_account.to_account_info(),
            to:ctx.accounts.token_vault.to_account_info(),
            authority:ctx.accounts.depositor.to_account_info(),
        };
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_transfer_instruction
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn create_proposal(ctx:Context<CreateProposal>,recipient:Pubkey,amount:u64,mint:Option<Pubkey>)->Result<()>{
        if !ctx.accounts.multisig.owners.contains(&ctx.accounts.creator.key()){
            return Err(MultisigError::CreatorNotOwner.into());
        }
        if amount==0{
            return Err(MultisigError::InvalidAmount.into());
        }
        ctx.accounts.proposal.wallet=ctx.accounts.multisig.key();
        ctx.accounts.proposal.creator=ctx.accounts.creator.key();
        ctx.accounts.proposal.recipient=recipient;
        ctx.accounts.proposal.amount=amount;
        ctx.accounts.proposal.mint=mint;
        ctx.accounts.proposal.approvals=Vec::new();
        ctx.accounts.proposal.cancels=Vec::new();
        ctx.accounts.proposal.status=ProposalStatus::Pending;

        let proposal_id = ctx.accounts.multisig.proposal_count;
        ctx.accounts.proposal.proposal_id = proposal_id;
        ctx.accounts.multisig.proposal_count = proposal_id
            .checked_add(1)
            .ok_or(MultisigError::ProposalCountOverflow)?;
        Ok(())
        
    }

    pub fn approve_proposal(ctx:Context<ApproveProposal>)->Result<()>{
        if !matches!(ctx.accounts.proposal.status,ProposalStatus::Pending){
            return Err(MultisigError::ProposalNotPending.into());

        }
        if ctx.accounts.multisig.owners.contains(&ctx.accounts.approver.key()){
            if !ctx.accounts.proposal.approvals.contains(&ctx.accounts.approver.key()){
                if ctx.accounts.proposal.cancels.contains(&ctx.accounts.approver.key()){
                    return Err(MultisigError::AlreadyVoted.into());
                }
                ctx.accounts.proposal.approvals.push(ctx.accounts.approver.key());
            }
            else{
                return Err(MultisigError::DoubleVoting.into());
            }
        }else{
            return Err(MultisigError::ApproverNotOwner.into());
        }
        if ctx.accounts.proposal.approvals.len() >= ctx.accounts.multisig.threshold as usize{
            ctx.accounts.proposal.status=ProposalStatus::Ready;
        }
        
        Ok(())
    }

    pub fn cancel_proposal(ctx:Context<CancelProposal>)->Result<()>{
        if !matches!(ctx.accounts.proposal.status,ProposalStatus::Pending){
            return Err(MultisigError::ProposalNotPending.into());
        }
        if ctx.accounts.multisig.owners.contains(&ctx.accounts.canceller.key()){
            if !ctx.accounts.proposal.cancels.contains(&ctx.accounts.canceller.key()){
                if ctx.accounts.proposal.approvals.contains(&ctx.accounts.canceller.key()){
                    return Err(MultisigError::AlreadyVoted.into());
                }
                ctx.accounts.proposal.cancels.push(ctx.accounts.canceller.key());
            }
            else{
                return Err(MultisigError::DoubleCancellation.into());
            }
        }else{
            return Err(MultisigError::CancellerNotOwner.into());
        } 
        
        if ctx.accounts.proposal.cancels.len()>=ctx.accounts.multisig.threshold as usize{
            ctx.accounts.proposal.status=ProposalStatus::Cancelled;
        }
        Ok(())
    }

    pub fn execute_proposal(ctx:Context<ExecuteProposal>)->Result<()>{
        if !matches!(ctx.accounts.proposal.status,ProposalStatus::Ready){
            return Err(MultisigError::ProposalNotReady.into());
        }
        let rent = Rent::get()?;
        let minimum_balance = rent.minimum_balance(ctx.accounts.vault.data_len()); 

        let vault_balance = ctx.accounts.vault.lamports();

        if vault_balance < ctx.accounts.proposal.amount + minimum_balance {
            return Err(MultisigError::InsufficientVaultFunds.into());
        }

        let multisig_key=ctx.accounts.multisig.key();
        let signer_seeds=&[
            b"vault",
            multisig_key.as_ref(),
            &[ctx.bumps.vault],
        ];

        let transfer_instruction=system_program::Transfer{
            from:ctx.accounts.vault.to_account_info(),
            to:ctx.accounts.recipient.to_account_info(),
        };
        
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_instruction,
                &[signer_seeds],
            ),
            ctx.accounts.proposal.amount,
        )?;

        ctx.accounts.proposal.status=ProposalStatus::Executed;
        Ok(())
    }

    pub fn execute_token_proposal(ctx:Context<ExecuteTokenProposal>)->Result<()>{
        if !matches!(ctx.accounts.proposal.status,ProposalStatus::Ready){
            return Err(MultisigError::ProposalNotReady.into());
        }

        if ctx.accounts.token_vault.amount < ctx.accounts.proposal.amount{
            return Err(MultisigError::InsufficientVaultFunds.into());
        }
    
        let initializer = ctx.accounts.multisig.initializer.key();
        let wallet_id = ctx.accounts.multisig.wallet_id;
        let binding=wallet_id.to_le_bytes();
        let signer_seeds=&[
            b"multisig",
            initializer.as_ref(),
            binding.as_ref(),
            &[ctx.bumps.multisig],
        ];

        let token_transfer_instruction = anchor_spl::token::TransferChecked{
            from: ctx.accounts.token_vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.multisig.to_account_info(),
        };

        anchor_spl::token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_transfer_instruction,
                &[signer_seeds],
            ),
            ctx.accounts.proposal.amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.proposal.status=ProposalStatus::Executed;

        Ok(())
    }

    pub fn remove_proposal(ctx:Context<RemoveProposal>)->Result<()>{
        if !ctx.accounts.multisig.owners.contains(&ctx.accounts.remover.key()){
            return Err(MultisigError::RemoverNotOwner.into());
        }
        if !matches!(ctx.accounts.proposal.status,ProposalStatus::Executed | ProposalStatus::Cancelled){
            return Err(MultisigError::ProposalNotExecuted.into());
        }
        
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

#[derive(Accounts)]
pub struct InitializeVault<'info>{
    #[account(mut)]
    pub initializer:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    /// CHECK: The vault is a PDA derived from the multisig and is used only
    /// as a SOL-holding account.
    #[account(
        init,
        payer=initializer,
        space=0,
        owner = system_program::ID,
        seeds=[b"vault",multisig.key().as_ref()],
        bump,
        constraint=multisig.initializer==initializer.key() @MultisigError::InvalidInitializer
    )]
    pub vault:UncheckedAccount<'info>,

    #[account()]
    pub system_program:Program<'info,System>,
}

#[derive(Accounts)]
pub struct InitializeTokenVault<'info>{
    #[account(mut)]
    pub payer:Signer<'info>,
    
    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
        )]
    pub multisig:Account<'info,Multisig>,

    pub mint:Account<'info,Mint>,

    #[account(
        init,
        payer=payer,
        token::mint=mint,
        token::authority=multisig,
        seeds=[b"token_vault",multisig.key().as_ref(),mint.key().as_ref()],
        bump
    )]
    pub token_vault:Account<'info,TokenAccount>,

    pub token_program:Program<'info,Token>,

    pub system_program:Program<'info,System>,

}

#[derive(Accounts)]
pub struct Deposit<'info>{
    #[account(mut)]
    pub depositor:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    /// CHECK: The vault is a PDA derived from the multisig
    /// and is used only as a SOL-holding account.
    #[account(
        mut,
        seeds=[b"vault",multisig.key().as_ref()],
        bump,
        constraint = *vault.owner == system_program::ID
    )]
    pub vault:UncheckedAccount<'info>,

    #[account()]
    pub system_program:Program<'info,System>
}

#[derive(Accounts)]
pub struct DepositToken<'info>{
    #[account(mut)]
    pub depositor:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account()]
    pub mint:Account<'info,Mint>,

    #[account(
        mut,
        seeds=[b"token_vault",multisig.key().as_ref(),mint.key().as_ref()],
        bump,
        constraint=token_vault.mint==mint.key() @MultisigError::InvalidMint,
        constraint = token_vault.owner == multisig.key() @MultisigError::InvalidOwner,
    )]
    pub token_vault:Account<'info,TokenAccount>,

    #[account(
        mut,
        constraint=depositor_token_account.owner==depositor.key() @MultisigError::InvalidDepositor,
        constraint=depositor_token_account.mint==mint.key() @MultisigError::InvalidMint
    )]
    pub depositor_token_account:Account<'info,TokenAccount>,

    pub token_program:Program<'info,Token>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info>{
    #[account(mut)]
    pub creator:Signer<'info>,

    #[account(
        mut,
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub multisig:Account<'info,Multisig>,

    #[account(
        init,
        payer=creator,
        space=8+Proposal::INIT_SPACE,
        seeds=[b"proposal",multisig.key().as_ref(),multisig.proposal_count.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal:Account<'info,Proposal>,

    pub system_program:Program<'info,System>
}

#[derive(Accounts)]
pub struct ApproveProposal<'info>{
    #[account()]
    pub approver:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account(
        mut,
        seeds=[b"proposal",multisig.key().as_ref(),proposal.proposal_id.to_le_bytes().as_ref()],
        bump,
        constraint=proposal.wallet==multisig.key() @MultisigError::InvalidProposalWallet
    )]
    pub proposal:Account<'info,Proposal>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info>{
    #[account(mut)]
    pub canceller:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account(
        mut,
        seeds=[b"proposal",multisig.key().as_ref(),proposal.proposal_id.to_le_bytes().as_ref()],
        bump,
        constraint=proposal.wallet==multisig.key() @MultisigError::InvalidProposalWallet
    )]
    pub proposal:Account<'info,Proposal>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info>{
    #[account(mut)]
    pub executor:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account(
        mut,
        seeds=[b"proposal",multisig.key().as_ref(),proposal.proposal_id.to_le_bytes().as_ref()],
        bump,
        constraint=proposal.wallet==multisig.key() @MultisigError::InvalidProposalWallet,
        constraint=proposal.mint.is_none() @MultisigError::InvalidMint,
    )]
    pub proposal:Account<'info,Proposal>,

    /// CHECK: The vault is a PDA derived from the multisig and is used only
    /// as a SOL-holding account.
    #[account(
        mut,
        seeds=[b"vault",multisig.key().as_ref()],
        bump,
        constraint = *vault.owner == system_program::ID
    )]
    pub vault:UncheckedAccount<'info>,

    /// CHECK: The recipient address is validated against proposal.recipient
    /// before the transfer is executed.

    #[account(
        mut,
        constraint=recipient.key()==proposal.recipient @MultisigError::InvalidRecipient
    )]
    pub recipient:UncheckedAccount<'info>,

    #[account()]
    pub system_program:Program<'info,System>
}

#[derive(Accounts)]
pub struct ExecuteTokenProposal<'info>{
    #[account(mut)]
    pub executor:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account()]
    pub mint:Account<'info,Mint>,

    #[account(
        mut,
        seeds=[b"proposal",multisig.key().as_ref(),proposal.proposal_id.to_le_bytes().as_ref()],
        bump,
        constraint=proposal.wallet==multisig.key() @MultisigError::InvalidProposalWallet,
        constraint=proposal.mint==Some(mint.key()) @MultisigError::InvalidMint
    )]
    pub proposal:Account<'info,Proposal>,


    #[account(
        mut,
        seeds=[b"token_vault",multisig.key().as_ref(),mint.key().as_ref()],
        bump,
        constraint=token_vault.mint==mint.key() @MultisigError::InvalidMint,
        constraint = token_vault.owner == multisig.key() @MultisigError::InvalidOwner,
    )]
    pub token_vault:Account<'info,TokenAccount>,

    #[account(
        mut,
        constraint=recipient_token_account.owner==proposal.recipient @MultisigError::InvalidRecipient,
        constraint=recipient_token_account.mint==mint.key() @MultisigError::InvalidMint
    )]
    pub recipient_token_account:Account<'info,TokenAccount>,

    pub token_program:Program<'info,Token>,

}

#[derive(Accounts)]
pub struct RemoveProposal<'info>{
    #[account(mut)]
    pub remover:Signer<'info>,

    #[account(
        seeds=[b"multisig",multisig.initializer.key().as_ref(),multisig.wallet_id.to_le_bytes().as_ref()],
        bump
    )]
    pub multisig:Account<'info,Multisig>,

    #[account(
        mut,
        close=remover,
        seeds=[b"proposal",multisig.key().as_ref(),proposal.proposal_id.to_le_bytes().as_ref()],
        bump,
        constraint=proposal.wallet==multisig.key() @MultisigError::InvalidProposalWallet
    )]
   pub proposal:Account<'info,Proposal>,
}

#[account]
#[derive(InitSpace)]
pub struct Multisig {
    pub initializer:Pubkey,
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
    pub proposal_id:u64,
    pub creator:Pubkey,
    pub recipient:Pubkey,
    pub amount:u64,
    pub mint:Option<Pubkey>,
    #[max_len(10)]
    pub approvals:Vec<Pubkey>,
    #[max_len(10)]
    pub cancels:Vec<Pubkey>,
    pub status:ProposalStatus
}

#[derive(AnchorSerialize,AnchorDeserialize,Clone,InitSpace)]
pub enum ProposalStatus{
    Pending,
    Ready,
    Executed,
    Cancelled
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
    #[msg("The creator is not an owner of the multisig")]
    CreatorNotOwner,
    #[msg("The approver is not an owner of the multisig")]
    ApproverNotOwner,
    #[msg("The approver has already voted for this proposal")]
    DoubleVoting,
    #[msg("The proposal does not belong to the specified multisig wallet")]
    InvalidProposalWallet,
    #[msg("The proposal is not in pending state")]
    ProposalNotPending,
    #[msg("The recipient does not match the proposal's recipient")]
    InvalidRecipient,
    #[msg("The proposal is not ready for execution")]
    ProposalNotReady,
    #[msg("The transfer amount must be greater than zero")]
    InvalidAmount,
    #[msg("The vault does not have enough SOL to execute this proposal")]
    InsufficientVaultFunds,
    #[msg("The proposal is not executed yet")]
    ProposalNotExecuted,
    #[msg("The remover is not an owner of the multisig")]
    RemoverNotOwner,
    #[msg("The canceller is not an owner of the multisig")]
    CancellerNotOwner,
    #[msg("The canceller has already cancelled this proposal")]
    DoubleCancellation,
    #[msg("The canceller has already voted for this proposal")]
    AlreadyVoted,
    #[msg("The initializer is not valid for this multisig")]
    InvalidInitializer,
    #[msg("The depositor is not valid for this token deposit")]
    InvalidDepositor,
    #[msg("The mint does not match the expected token vault mint")]
    InvalidMint,
    #[msg("The owner of the token vault does not match the multisig")]
    InvalidOwner,
    #[msg("The proposal count has overflowed")]
    ProposalCountOverflow,
}