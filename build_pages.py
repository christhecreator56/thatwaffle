import os
import shutil
import zipfile

project_root = os.path.dirname(os.path.abspath(__file__))
site_dir = os.path.join(project_root, 'site')
dist_dir = os.path.join(project_root, 'dist_pages')
zip_path = os.path.join(project_root, 'thatwaffle-site.zip')

print(f"Building clean static assets package from: {site_dir}")

# Clear and rebuild dist_pages
if os.path.exists(dist_dir):
    shutil.rmtree(dist_dir)
os.makedirs(dist_dir, exist_ok=True)

# Copy site directory contents only (pure static assets)
for item in os.listdir(site_dir):
    s = os.path.join(site_dir, item)
    d = os.path.join(dist_dir, item)
    if os.path.isdir(s):
        shutil.copytree(s, d)
    else:
        shutil.copy2(s, d)

# Create thatwaffle-site.zip with purely static assets
if os.path.exists(zip_path):
    os.remove(zip_path)

file_count = 0
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            full_path = os.path.join(root, f)
            arc_name = os.path.relpath(full_path, dist_dir)
            z.write(full_path, arc_name)
            file_count += 1

zip_size = os.path.getsize(zip_path)
print(f"SUCCESS: Package created at {zip_path} with {file_count} static files ({zip_size:,} bytes)")
