from setuptools import setup
import os
from glob import glob

package_name = 'pick2build'

setup(
    name=package_name,
    version='0.0.0',
    packages=[package_name],
    data_files=[
        # ROS 2 패키지 인덱스 마커
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        
        # 💡 모든 리소스를 'share/pick2build/resource' 폴더 하나로 통합 설치
        (os.path.join('share', package_name, 'resource'), 
            glob('resource/*') +              # resource 폴더 내 모든 파일
            glob('pick2build/*.npy') +        # pick2build 폴더 내 변환 행렬
            glob('pick2build/*.json') +       # pick2build 폴더 내 설정 파일
            glob('pick2build/*.pt') +         # pick2build 폴더 내 YOLO 모델
            glob('pick2build/*.task') +       # pick2build 폴더 내 MediaPipe 모델
            glob('pick2build/*.tflite') +     # pick2build 폴더 내 TFLite 모델
            glob('pick2build/.env')           # pick2build 폴더 내 API Key
        ),
        
        # 로봇 파라미터 설정 파일
        (os.path.join('share', package_name, 'config'), glob('pick2build/config/*')),

        # 런치 파일 설치
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Rokey',
    maintainer_email='user@todo.todo',
    description='Integrated Robotic System for Pick and Place',
    license='Apache License 2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'stage_place = pick2build.stage_place:main',
            'get_keyword = pick2build.get_keyword:main',
            'detection = pick2build.detection:main',
        ],
    },
)