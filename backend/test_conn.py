from dotenv import load_dotenv
import os
load_dotenv()

host      = os.getenv('DATABRICKS_HOST', '').replace('https://','').replace('http://','').rstrip('/')
http_path = os.getenv('DATABRICKS_HTTP_PATH')
token     = os.getenv('DATABRICKS_TOKEN')

from databricks import sql as dbsql
conn   = dbsql.connect(server_hostname=host, http_path=http_path, access_token=token)
cursor = conn.cursor()

cursor.execute('DESCRIBE TABLE catalog_central.medallion_config.tbl_config')
rows = cursor.fetchall()
print('\n--- tbl_config COLUMNS ---')
for row in rows:
    print(f'  {row[0]:40s} {row[1]}')

cursor.close()
conn.close()