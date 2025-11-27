# Generated migration for authentication app (MySQL compatible)

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='User',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('email', models.EmailField(max_length=255, unique=True)),
                ('password_hash', models.CharField(max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'users',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='RefreshToken',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('token', models.CharField(max_length=500)),
                ('expires_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='refresh_tokens', to='authentication.user')),
            ],
            options={
                'db_table': 'refresh_tokens',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='refreshtoken',
            index=models.Index(fields=['user'], name='refresh_tok_user_id_idx'),
        ),
        migrations.AddIndex(
            model_name='refreshtoken',
            index=models.Index(fields=['token'], name='refresh_tok_token_idx'),
        ),
    ]
