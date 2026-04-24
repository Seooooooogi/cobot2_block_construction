from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    est_iter = DeclareLaunchArgument('est_refine_iter', default_value='20')
    track_iter = DeclareLaunchArgument('track_refine_iter', default_value='20')

    return LaunchDescription([
        est_iter,
        track_iter,
        Node(
            package='zium_detection',
            executable='foundation_pose',
            name='foundation_pose_node',
            namespace='dsr01',
            output='screen',
            arguments=[
                '--est_refine_iter', LaunchConfiguration('est_refine_iter'),
                '--track_refine_iter', LaunchConfiguration('track_refine_iter'),
            ],
        ),
    ])
