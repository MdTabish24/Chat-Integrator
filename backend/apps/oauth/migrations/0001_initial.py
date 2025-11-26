# Generated migration for oauth app

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('authentication', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ConnectedAccount',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('platform', models.CharField(choices=[('telegram', 'Telegram'), ('twitter', 'Twitter'), ('linkedin', 'LinkedIn'), ('instagram', 'Instagram'), ('whatsapp', 'WhatsApp'), ('facebook', 'Facebook'), ('teams', 'Microsoft Teams')], max_length=50)),
                ('platform_user_id', models.CharField(max_length=255)),
                ('platform_username', models.CharField(blank=True, max_length=255, null=True)),
                ('access_token', models.TextField()),
                ('refresh_token', models.TextField(blank=True, null=True)),
                ('token_expires_at', models.DateTimeField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='connected_accounts', to='authentication.user')),
            ],
            options={
                'db_table': 'connected_accounts',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='connectedaccount',
            index=models.Index(fields=['user'], name='connected_a_user_id_idx'),
        ),
        migrations.AddIndex(
            model_name='connectedaccount',
            index=models.Index(fields=['platform'], name='connected_a_platfor_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='connectedaccount',
            unique_together={('user', 'platform', 'platform_user_id')},
        ),
    ]
