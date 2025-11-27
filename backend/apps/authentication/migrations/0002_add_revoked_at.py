# Add revoked_at column to existing refresh_tokens table

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('authentication', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            # Add column if it doesn't exist (MySQL compatible)
            sql="""
            ALTER TABLE refresh_tokens 
            ADD COLUMN IF NOT EXISTS revoked_at DATETIME NULL;
            """,
            reverse_sql="ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS revoked_at;"
        ),
    ]
