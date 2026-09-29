import StageModule from 'openfl/lib/openfl/display/Stage';
import SpriteModule from 'openfl/lib/openfl/display/Sprite';
import BitmapModule from 'openfl/lib/openfl/display/Bitmap';
import BitmapDataModule from 'openfl/lib/openfl/display/BitmapData';
import PointModule from 'openfl/lib/openfl/geom/Point';
import RectangleModule from 'openfl/lib/openfl/geom/Rectangle';
import ColorTransformModule from 'openfl/lib/openfl/geom/ColorTransform';
import MouseEventModule from 'openfl/lib/openfl/events/MouseEvent';
import EventModule from 'openfl/lib/openfl/events/Event';
import CapsStyleModule from 'openfl/lib/openfl/display/CapsStyle';
import JointStyleModule from 'openfl/lib/openfl/display/JointStyle';
import LineScaleModeModule from 'openfl/lib/openfl/display/LineScaleMode';

// OpenFL 9.5.2's CommonJS wrappers may retain an extra default under Vite.
// Normalize only at this adapter boundary, preserving the package's declarations.
function unwrap<T>(module: T): T {
  return (module as { default?: T }).default ?? module;
}
export const Stage = unwrap(StageModule);
export const Sprite = unwrap(SpriteModule);
export const Bitmap = unwrap(BitmapModule);
export const BitmapData = unwrap(BitmapDataModule);
export const Point = unwrap(PointModule);
export const Rectangle = unwrap(RectangleModule);
export const ColorTransform = unwrap(ColorTransformModule);
export const MouseEvent = unwrap(MouseEventModule);
export const Event = unwrap(EventModule);
export const CapsStyle = unwrap(CapsStyleModule);
export const JointStyle = unwrap(JointStyleModule);
export const LineScaleMode = unwrap(LineScaleModeModule);
export type BitmapData = BitmapDataModule;
export type Rectangle = RectangleModule;
