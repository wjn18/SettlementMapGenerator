import StageModule from 'openfl/lib/openfl/display/Stage';
import SpriteModule from 'openfl/lib/openfl/display/Sprite';
import CapsModule from 'openfl/lib/openfl/display/CapsStyle';
import JointsModule from 'openfl/lib/openfl/display/JointStyle';
import ScaleModule from 'openfl/lib/openfl/display/LineScaleMode';
import OpenGLModule from 'openfl/lib/openfl/display/OpenGLRenderer';
import BitmapModule from 'openfl/lib/openfl/display/Bitmap';
import BitmapDataModule from 'openfl/lib/openfl/display/BitmapData';
// OpenFL's CJS default can be wrapped twice by Vite; normalize at the boundary.
function unwrap<T>(module: T): T { return (module as { default?: T }).default ?? module; }
export const Stage = unwrap(StageModule), Sprite = unwrap(SpriteModule);
export const OpenGLRenderer = unwrap(OpenGLModule);
export const Bitmap = unwrap(BitmapModule), BitmapData = unwrap(BitmapDataModule);
export const CapsStyle = unwrap(CapsModule), JointStyle = unwrap(JointsModule), LineScaleMode = unwrap(ScaleModule);
