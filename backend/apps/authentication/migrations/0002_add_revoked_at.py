# Add revoked_at column to existing refresh_tokens table

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('authentication', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            # Add column if it doesn't exist
            sql="""
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='refresh_tokens' AND column_name='revoked_at'
                ) THEN
                    ALTER TABLE refresh_tokens ADD COLUMN revoked_at TIMESTAMP NULL;
                END IF;
            END $$;
            """,
            reverse_sql="ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS revoked_at;"
        ),
    ]
