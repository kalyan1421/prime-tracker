# Remote state for the production (client) account 056836825737. Not secret: it names
# where the state lives; reading it needs credentials for that account.
bucket         = "prime-tracker-tfstate-056836825737"
key            = "prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "prime-tracker-tflock"
encrypt        = true
