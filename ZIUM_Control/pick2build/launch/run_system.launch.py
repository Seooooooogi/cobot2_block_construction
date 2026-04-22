import os
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        # 1. 로봇 메인 제어 노드 실행
        Node(
            package='pick2build',          
            executable='stage_place',      
            name='stage_place_node',
            output='screen',
            emulate_tty=True               
        ),
        
        # 2. 음성 인식(서비스) 노드 동시 실행 
        Node(
            package='pick2build',
            executable='get_keyword',
            name='get_keyword_node',
            output='screen',
            emulate_tty=True
        ),
        Node(
            package='pick2build',
            executable='detection',
            name='object_detection_node',
            output='screen',
            emulate_tty=True
        )
    ])